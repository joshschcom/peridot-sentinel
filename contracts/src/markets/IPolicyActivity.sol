// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IPolicyActivity {
    /// @notice A circuit approved an action which settled in this transaction.
    event PolicyAllowed(bytes32 indexed policyId, address indexed account, uint8 indexed op,
        uint256 postLtvBps, bool oracleFresh, bool cashOk);
}
