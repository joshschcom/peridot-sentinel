// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ChainlinkSwapQuoteSource} from "../../src/swap/ChainlinkSwapQuoteSource.sol";

interface VmQuote {
    function warp(uint256) external;
    function expectRevert(bytes4) external;
}

contract FeedFixture {
    uint8 public constant decimals = 8;
    int256 public value;
    uint256 public time;
    uint80 public answeredRound = 1;

    function put(int256 v, uint256 t, uint80 round) external {
        (value, time, answeredRound) = (v, t, round);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, value, time, time, answeredRound);
    }
}

contract ChainlinkSwapQuoteTest {
    VmQuote constant vm = VmQuote(address(uint160(uint256(keccak256("hevm cheat code")))));

    function testRoundAndSequencerRecoveryValidation() public {
        vm.warp(100_000);
        FeedFixture a = new FeedFixture();
        FeedFixture b = new FeedFixture();
        FeedFixture uptime = new FeedFixture();
        ChainlinkSwapQuoteSource source =
            new ChainlinkSwapQuoteSource(address(a), address(b), address(a), address(b), address(uptime));
        a.put(82e8, 99_980, 1);
        b.put(1e8, 99_991, 1);
        uptime.put(1, 90_000, 1);
        vm.expectRevert(ChainlinkSwapQuoteSource.SequencerUnavailable.selector);
        source.price(address(a));
        uptime.put(0, 99_900, 1);
        vm.expectRevert(ChainlinkSwapQuoteSource.SequencerUnavailable.selector);
        source.price(address(a));
        uptime.put(0, 90_000, 1);
        (uint256 price, uint256 updated) = source.price(address(a));
        require(price == 82e18 && updated == 99_980);
        a.put(-1, 99_980, 1);
        vm.expectRevert(ChainlinkSwapQuoteSource.InvalidFeed.selector);
        source.price(address(a));
        a.put(82e8, 99_980, 0);
        vm.expectRevert(ChainlinkSwapQuoteSource.InvalidFeed.selector);
        source.price(address(a));
        b.put(1e8, 100_001, 1);
        vm.expectRevert(ChainlinkSwapQuoteSource.InvalidFeed.selector);
        source.price(address(b));
    }
}
