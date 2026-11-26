// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {NativeCircuitWitness} from "./NativeCircuitWitness.sol";
import {ExecutionPolicy} from "../policy/ExecutionPolicy.sol";

interface INativeRegistry {
    function requirePolicy(bytes32 id, uint8 kind) external view returns (address processor, uint256 circuitId);
}

interface INativeLendingPolicy {
    function registry() external view returns (INativeRegistry);
    function enforce(bytes32 id, uint8 kind, uint8 op, bool fresh, uint256 postLtvBps, bool cashOk) external view;
}

/// @notice Fork-only financial wiring. Frozen published program IDs and existing canonical V1/V2 adapters.
contract NativeFinancialPolicy {
    NativeCircuitWitness public immutable witness;
    INativeLendingPolicy public immutable lendingPolicy;
    ExecutionPolicy public immutable executionPolicy;
    bytes32 public immutable marketPolicyId;
    bytes32 public immutable accountPolicyId;

    error PolicyIdentityMismatch();

    constructor(NativeCircuitWitness witness_, INativeLendingPolicy lending_, ExecutionPolicy execution_,
        bytes32 market_, bytes32 account_) {
        if (block.chainid != 31337 || market_ == account_) revert PolicyIdentityMismatch();
        address cpu = witness_.CPU();
        INativeRegistry registry = lending_.registry();
        (address m, uint256 mid) = registry.requirePolicy(market_, 0);
        (address a, uint256 aid) = registry.requirePolicy(account_, 1);
        if (m != cpu || a != cpu || execution_.processor() != cpu || mid != witness_.marketId()
            || aid != witness_.accountId() || execution_.circuitId() != witness_.executionId()) revert PolicyIdentityMismatch();
        witness = witness_;
        lendingPolicy = lending_;
        executionPolicy = execution_;
        marketPolicyId = market_;
        accountPolicyId = account_;
    }

    function enforce(bytes32 id, uint8 kind, uint8 op, bool fresh, uint256 postLtvBps, bool cashOk) external view {
        if (kind > 1 || id != (kind == 0 ? marketPolicyId : accountPolicyId)) revert PolicyIdentityMismatch();
        witness.checkRuntime();
        lendingPolicy.enforce(id, kind, op, fresh, postLtvBps, cashOk);
    }

    function enforceSwap(uint8 flags, uint16 slippageBps) external view {
        witness.checkRuntime();
        executionPolicy.enforceSwap(flags, slippageBps);
    }
}
