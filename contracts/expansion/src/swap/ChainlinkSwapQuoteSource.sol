// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface ISwapFeed {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

/// @notice Independent USD prices for the two selected assets. The adapter checks both ages.
/// This implementation accepts eight-decimal feeds and requires one hour after sequencer recovery.
contract ChainlinkSwapQuoteSource {
    address public immutable assetA;
    address public immutable assetB;
    ISwapFeed public immutable feedA;
    ISwapFeed public immutable feedB;
    ISwapFeed public immutable sequencer;
    error InvalidFeed();
    error SequencerUnavailable();

    constructor(address a, address b, address feedA_, address feedB_, address uptimeFeed) {
        if (
            a == b || a.code.length == 0 || b.code.length == 0 || feedA_ == feedB_ || uptimeFeed.code.length == 0
                || ISwapFeed(feedA_).decimals() != 8 || ISwapFeed(feedB_).decimals() != 8
        ) revert InvalidFeed();
        (assetA, assetB, feedA, feedB, sequencer) = (a, b, ISwapFeed(feedA_), ISwapFeed(feedB_), ISwapFeed(uptimeFeed));
    }

    function price(address asset) external view returns (uint256 usdWad, uint256 updatedAt) {
        (, int256 status, uint256 startedAt,,) = sequencer.latestRoundData();
        if (status != 0 || startedAt == 0 || startedAt > block.timestamp || block.timestamp - startedAt <= 1 hours) {
            revert SequencerUnavailable();
        }
        if (asset != assetA && asset != assetB) revert InvalidFeed();
        (uint80 roundId, int256 answer,, uint256 time, uint80 answeredInRound) =
            (asset == assetA ? feedA : feedB).latestRoundData();
        if (roundId == 0 || answer <= 0 || answeredInRound < roundId || time == 0 || time > block.timestamp) {
            revert InvalidFeed();
        }
        return (uint256(answer) * 1e10, time);
    }
}
