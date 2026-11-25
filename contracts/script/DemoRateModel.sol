// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.26;

import {JumpRateModel} from "../src/core/JumpRateModel.sol";
import {TestProfile} from "../src/markets/TestProfile.sol";

/// @notice Fixed fixture parameters for exercising the baseline's per-block interest accrual.
contract DemoRateModel is JumpRateModel, TestProfile {
    constructor() JumpRateModel(0.02e18, 0.05e18, 0.2e18, 0.8e18) {}
}
