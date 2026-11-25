// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPolicyProcessor, PolicyRegistry} from "./PolicyRegistry.sol";

contract TapeOutPolicyAdapter {
    PolicyRegistry public immutable registry;
    uint256 public constant EVAL_GAS = 1_500_000;

    error InvalidContext();
    error MarketPolicyRejected(bytes32 policyId, uint8 reasonCode);
    error AccountPolicyRejected(bytes32 policyId, uint8 reasonCode);
    error PolicyEvaluationFailed(bytes32 policyId);

    constructor(PolicyRegistry registry_) {
        require(address(registry_).code.length > 0);
        registry = registry_;
    }

    function encodeContext(uint8 op, bool fresh, uint256 postLtvBps, bool cashOk) public pure returns (bytes memory) {
        if (op > 9 || postLtvBps > 10000) revert InvalidContext();
        uint256 bits = op | (fresh ? uint256(1) << 4 : 0) | (postLtvBps << 5) | (cashOk ? uint256(1) << 19 : 0);
        return abi.encodePacked(uint8(bits), uint8(bits >> 8), uint8(bits >> 16));
    }

    /// @notice Risk classification and authoritative input calculation belong to the caller.
    function enforce(bytes32 id, uint8 kind, uint8 op, bool oracleFresh, uint256 postLtvBps, bool cashOk) external view {
        (address processor, uint256 circuitId) = registry.requirePolicy(id, kind);
        bytes memory data = abi.encodeCall(IPolicyProcessor.eval, (circuitId, encodeContext(op, oracleFresh, postLtvBps, cashOk)));
        bool valid;
        uint256 decision;
        // Copy exactly three ABI words regardless of how much data the processor returns.
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            let ok := staticcall(EVAL_GAS, processor, add(data, 32), mload(data), ptr, 96)
            valid := and(and(ok, eq(returndatasize(), 96)), and(eq(mload(ptr), 32), eq(mload(add(ptr, 32)), 1)))
            decision := mload(add(ptr, 64))
        }
        if (!valid || (decision != 0 && decision != 1 << 248)) revert PolicyEvaluationFailed(id);
        if (decision == 0) {
            if (kind == 0) revert MarketPolicyRejected(id, 1);
            revert AccountPolicyRejected(id, 1);
        }
    }
}
