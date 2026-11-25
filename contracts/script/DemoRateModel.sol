// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.26;

import {InterestRateModel} from "../src/core/InterestRateModel.sol";
import {TestProfile} from "../src/markets/TestProfile.sol";

/// @notice The fixed demo jump-rate curve, expressed per block at the deployment profile's cadence.
contract DemoRateModel is InterestRateModel, TestProfile {
    uint256 private constant WAD = 1e18;
    uint256 public constant kink = 0.8e18;
    uint256 public immutable blocksPerYear;
    uint256 public immutable baseRatePerBlock;
    uint256 public immutable multiplierPerBlock;
    uint256 public immutable jumpMultiplierPerBlock;

    event NewInterestParams(
        uint256 baseRatePerBlock, uint256 multiplierPerBlock, uint256 jumpMultiplierPerBlock, uint256 kink
    );

    constructor(uint256 blocksPerYear_) {
        require(blocksPerYear_ != 0, "zero blocks per year");
        blocksPerYear = blocksPerYear_;
        baseRatePerBlock = 0.02e18 / blocksPerYear_;
        multiplierPerBlock = 0.05e18 / blocksPerYear_;
        jumpMultiplierPerBlock = 0.20e18 / blocksPerYear_;
        emit NewInterestParams(baseRatePerBlock, multiplierPerBlock, jumpMultiplierPerBlock, kink);
    }

    function utilizationRate(uint256 cash, uint256 borrows, uint256 reserves) public pure returns (uint256) {
        return borrows == 0 ? 0 : borrows * WAD / (cash + borrows - reserves);
    }

    function getBorrowRate(uint256 cash, uint256 borrows, uint256 reserves) public view override returns (uint256) {
        uint256 utilization = utilizationRate(cash, borrows, reserves);
        if (utilization <= kink) return baseRatePerBlock + utilization * multiplierPerBlock / WAD;

        uint256 rateAtKink = baseRatePerBlock + kink * multiplierPerBlock / WAD;
        return rateAtKink + (utilization - kink) * jumpMultiplierPerBlock / WAD;
    }

    function getSupplyRate(uint256 cash, uint256 borrows, uint256 reserves, uint256 reserveFactorMantissa)
        external
        view
        override
        returns (uint256)
    {
        uint256 rateToPool = getBorrowRate(cash, borrows, reserves) * (WAD - reserveFactorMantissa) / WAD;
        return utilizationRate(cash, borrows, reserves) * rateToPool / WAD;
    }
}
