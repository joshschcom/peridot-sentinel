// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {TestnetInventoryVenue} from "../../src/swap/TestnetInventoryVenue.sol";

/// @notice Unforked local demo fixture. Current block time describes a fixed simulation.
contract LocalVenueQuotes {
    TestnetInventoryVenue public immutable venue;

    constructor(TestnetInventoryVenue venue_) {
        require(block.chainid == 31337 && address(venue_).code.length > 0);
        venue = venue_;
    }

    function quotes(address asset) external view returns (uint192 price, uint64 timestamp) {
        // The venue constructor bounds both prices to uint128 and fixes the token ordering.
        if (asset == venue.token0()) price = uint192(venue.price0());
        else if (asset == venue.token1()) price = uint192(venue.price1());
        else return (0, 0);
        return (price, uint64(block.timestamp));
    }
}
