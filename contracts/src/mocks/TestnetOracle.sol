// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {TestProfile} from "../markets/TestProfile.sol";

/// @notice Manually priced testnet fixture. Quotes are USD WAD per whole token.
contract TestnetOracle is TestProfile {
    uint256 public constant MAX_AGE = 1 days;
    address public immutable owner = msg.sender;

    struct Quote {
        uint192 price;
        uint64 timestamp;
    }
    mapping(address => Quote) public quotes;
    event PriceSet(address indexed asset, uint256 priceWad, uint256 timestamp);

    function setPrice(address asset, uint256 priceWad) external {
        require(msg.sender == owner && asset != address(0) && priceWad > 0 && priceWad <= type(uint192).max);
        quotes[asset] = Quote(uint192(priceWad), uint64(block.timestamp));
        emit PriceSet(asset, priceWad, block.timestamp);
    }

    function price(address asset) external view returns (uint256 usdWad, bool fresh) {
        Quote memory q = quotes[asset];
        return (q.price, q.price > 0 && block.timestamp <= uint256(q.timestamp) + MAX_AGE);
    }
}
