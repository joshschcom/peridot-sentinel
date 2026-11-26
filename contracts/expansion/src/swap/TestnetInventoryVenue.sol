// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IFixedRouter, SwapConversion} from "./SinglePoolSwapAdapter.sol";

abstract contract SwapFixture {
    error TestnetOnly();

    constructor() {
        if (block.chainid != 1952 && block.chainid != 31337) revert TestnetOnly();
    }
}

interface ITestQuotes {
    function quotes(address) external view returns (uint192, uint64);
}

contract TestnetSwapQuoteSource is SwapFixture {
    ITestQuotes public immutable oracle;

    constructor(address fixtureOracle) {
        require(fixtureOracle.code.length != 0);
        oracle = ITestQuotes(fixtureOracle);
    }

    function price(address asset) external view returns (uint256 usdWad, uint256 updatedAt) {
        return oracle.quotes(asset);
    }
}

/// @notice Valueless testnet fixture, backed by ERC20 balances sent to this contract.
/// Fixed exchange rates and real inventory transfers mimic only exactInputSingle.
contract TestnetInventoryVenue is SwapFixture {
    uint24 public constant fee = 500;
    address public immutable token0;
    address public immutable token1;
    uint256 public immutable price0;
    uint256 public immutable price1;
    uint256 private immutable unit0;
    uint256 private immutable unit1;
    error InvalidRoute();
    error InsufficientOutput();

    constructor(address a, address b, uint256 priceAUsdWad, uint256 priceBUsdWad) {
        if (
            a == b || priceAUsdWad == 0 || priceBUsdWad == 0 || priceAUsdWad > type(uint128).max
                || priceBUsdWad > type(uint128).max
        ) revert InvalidRoute();
        (token0, token1) = a < b ? (a, b) : (b, a);
        (price0, price1) = a < b ? (priceAUsdWad, priceBUsdWad) : (priceBUsdWad, priceAUsdWad);
        (unit0, unit1) = (SwapConversion.unit(token0), SwapConversion.unit(token1));
    }

    function factory() external view returns (address) {
        return address(this);
    }

    function getPool(address a, address b, uint24 requestedFee) external view returns (address) {
        return requestedFee == fee && ((a == token0 && b == token1) || (a == token1 && b == token0))
            ? address(this)
            : address(0);
    }

    function exactInputSingle(IFixedRouter.ExactInputSingleParams calldata p)
        external
        payable
        returns (uint256 amountOut)
    {
        bool forward = p.tokenIn == token0 && p.tokenOut == token1;
        if (
            (!forward && (p.tokenIn != token1 || p.tokenOut != token0)) || p.fee != fee || p.sqrtPriceLimitX96 != 0
                || p.amountIn == 0 || p.recipient == address(0) || msg.value != 0
        ) revert InvalidRoute();
        uint256 gross = forward
            ? SwapConversion.quote(p.amountIn, price0, unit0, price1, unit1)
            : SwapConversion.quote(p.amountIn, price1, unit1, price0, unit0);
        amountOut = Math.mulDiv(gross, 1_000_000 - fee, 1_000_000);
        if (
            amountOut == 0 || amountOut < p.amountOutMinimum
                || amountOut > IERC20Metadata(p.tokenOut).balanceOf(address(this))
        ) revert InsufficientOutput();
        require(IERC20Metadata(p.tokenIn).transferFrom(msg.sender, address(this), p.amountIn));
        require(IERC20Metadata(p.tokenOut).transfer(p.recipient, amountOut));
    }
}
