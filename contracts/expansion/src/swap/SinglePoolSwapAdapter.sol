// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface IFixedRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function factory() external view returns (address);
    function exactInputSingle(ExactInputSingleParams calldata p) external payable returns (uint256);
}

interface IFixedPool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function factory() external view returns (address);
}

interface IFixedFactory {
    function getPool(address a, address b, uint24 fee) external view returns (address);
}

interface ISwapPriceSource {
    /// @dev USD WAD per whole token. Timestamp is the observation time, in seconds.
    function price(address asset) external view returns (uint256 usdWad, uint256 updatedAt);
}

library SwapConversion {
    error UnsupportedUnit();

    function unit(address asset) internal view returns (uint256) {
        uint8 decimals = IERC20Metadata(asset).decimals();
        if (decimals > 18) revert UnsupportedUnit();
        return 10 ** uint256(decimals);
    }

    function quote(uint256 amount, uint256 priceIn, uint256 unitIn, uint256 priceOut, uint256 unitOut)
        internal
        pure
        returns (uint256)
    {
        if (priceIn == 0 || priceOut == 0 || priceIn > type(uint128).max || priceOut > type(uint128).max) {
            revert UnsupportedUnit();
        }
        return Math.mulDiv(amount, priceIn * unitOut, priceOut * unitIn);
    }
}

/// @notice One immutable Uniswap V3 SwapRouter02 single-hop route. Every trade spends the caller's
/// idle tokens and pays the same caller. Each Sentinel account independently enforces its own policy.
contract SinglePoolSwapAdapter {
    uint24 public constant FEE = 500;
    address public immutable router;
    address public immutable factory;
    address public immutable pool;
    address public immutable token0;
    address public immutable token1;
    ISwapPriceSource public immutable priceSource;
    uint256 public immutable maxAge;
    uint16 public immutable hardSlippageBps;
    uint256 private immutable unit0;
    uint256 private immutable unit1;
    bool private entered;

    error InvalidConfiguration();
    error InvalidAsset();
    error InvalidAmount();
    error QuoteExpired();
    error SlippageLimit();
    error DeadlineExpired();
    error SettlementMismatch();
    error Reentered();
    event Swapped(
        address indexed account, address indexed input, address indexed output, uint256 amountIn, uint256 amountOut
    );

    constructor(
        address router_,
        address factory_,
        address a,
        address b,
        address priceSource_,
        uint256 maxAge_,
        uint16 hardSlippageBps_
    ) {
        if (
            a == b || a.code.length == 0 || b.code.length == 0 || router_.code.length == 0 || factory_.code.length == 0
                || priceSource_.code.length == 0 || maxAge_ == 0 || maxAge_ > 1 days || hardSlippageBps_ > 500
        ) revert InvalidConfiguration();
        (token0, token1) = a < b ? (a, b) : (b, a);
        pool = IFixedFactory(factory_).getPool(token0, token1, FEE);
        if (
            pool.code.length == 0 || IFixedRouter(router_).factory() != factory_
                || IFixedPool(pool).factory() != factory_ || IFixedPool(pool).token0() != token0
                || IFixedPool(pool).token1() != token1 || IFixedPool(pool).fee() != FEE
        ) {
            revert InvalidConfiguration();
        }
        unit0 = SwapConversion.unit(token0);
        unit1 = SwapConversion.unit(token1);
        priceSource = ISwapPriceSource(priceSource_);
        router = router_;
        factory = factory_;
        maxAge = maxAge_;
        hardSlippageBps = hardSlippageBps_;
    }

    function executionQuote(address tokenIn, uint256 amountIn)
        public
        view
        returns (uint256 expectedOut, uint256 floorOut, uint256 timestamp)
    {
        if (tokenIn != token0 && tokenIn != token1) revert InvalidAsset();
        if (amountIn == 0) revert InvalidAmount();
        (uint256 price0, uint256 time0) = priceSource.price(token0);
        (uint256 price1, uint256 time1) = priceSource.price(token1);
        timestamp = Math.min(time0, time1);
        if (
            timestamp == 0 || time0 > block.timestamp || time1 > block.timestamp || block.timestamp - timestamp > maxAge
        ) revert QuoteExpired();
        expectedOut = tokenIn == token0
            ? SwapConversion.quote(amountIn, price0, unit0, price1, unit1)
            : SwapConversion.quote(amountIn, price1, unit1, price0, unit0);
        if (expectedOut == 0) revert InvalidAmount();
        floorOut = Math.mulDiv(expectedOut, 10_000 - hardSlippageBps, 10_000, Math.Rounding.Ceil);
    }

    function swapExactIn(address tokenIn, uint256 amountIn, uint256 minOut, uint64 deadline)
        external
        returns (uint256 amountOut)
    {
        if (entered) revert Reentered();
        entered = true;
        if (block.timestamp > deadline) revert DeadlineExpired();
        (, uint256 floorOut,) = executionQuote(tokenIn, amountIn);
        if (minOut < floorOut) revert SlippageLimit();
        IERC20Metadata input = IERC20Metadata(tokenIn);
        IERC20Metadata output = IERC20Metadata(tokenIn == token0 ? token1 : token0);
        uint256 inputBefore = input.balanceOf(address(this));
        uint256 callerInputBefore = input.balanceOf(msg.sender);
        uint256 outputBefore = output.balanceOf(msg.sender);
        if (
            !input.transferFrom(msg.sender, address(this), amountIn)
                || input.balanceOf(address(this)) != inputBefore + amountIn || !input.approve(router, amountIn)
        ) revert SettlementMismatch();
        amountOut = IFixedRouter(router)
            .exactInputSingle(
                IFixedRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: address(output),
                fee: FEE,
                recipient: msg.sender,
                amountIn: amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
            );
        if (
            !input.approve(router, 0) || input.allowance(address(this), router) != 0
                || input.balanceOf(address(this)) != inputBefore
                || input.balanceOf(msg.sender) + amountIn != callerInputBefore || amountOut < minOut
                || output.balanceOf(msg.sender) != outputBefore + amountOut
        ) revert SettlementMismatch();
        entered = false;
        emit Swapped(msg.sender, tokenIn, address(output), amountIn, amountOut);
    }
}
