// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IFixedRouter, IFixedPool, IFixedFactory, ISwapPriceSource, SwapConversion} from "../swap/SinglePoolSwapAdapter.sol";

/// @notice One immutable Uniswap V3 SwapRouter02 single-hop route. Every trade spends the caller's
/// idle tokens and pays the same caller. Each Sentinel account independently enforces its own policy.
/// @dev Additive, undeployed revision of the pinned adapter. Reads router approval before use.
contract CheckedSinglePoolSwapAdapter {
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
                || input.allowance(address(this), router) != amountIn
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
