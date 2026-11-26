// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PeridotLendingAdapter} from "./PeridotLendingAdapter.sol";
import {SentinelAccountV2, IV2SwapAdapter, IV2ExecutionPolicy} from "./SentinelAccountV2.sol";

/// @notice One account per owner under this factory's immutable set of adapters and execution policy.
contract SentinelAccountFactoryV2 {
    PeridotLendingAdapter public immutable lendingAdapter;
    IV2SwapAdapter public immutable swapAdapter;
    IV2ExecutionPolicy public immutable executionPolicy;
    bytes32 public immutable lendingAdapterHash;
    bytes32 public immutable swapAdapterHash;
    bytes32 public immutable executionPolicyHash;
    mapping(address owner => address account) public accountOf;

    error UnsupportedChain(uint256 chainId);
    error InvalidConfiguration();
    error AdapterChanged();
    error AccountAlreadyExists(address existing);
    event AccountCreated(address indexed owner, address indexed account, bytes32 indexed policyId);

    constructor(PeridotLendingAdapter lending_, IV2SwapAdapter swap_, IV2ExecutionPolicy execution_) {
        if (block.chainid != 1952 && block.chainid != 31337) revert UnsupportedChain(block.chainid);
        if (
            address(lending_).code.length == 0 || address(swap_).code.length == 0
                || address(execution_).code.length == 0 || address(lending_) == address(swap_)
                || address(lending_) == address(execution_) || address(swap_) == address(execution_)
        ) {
            revert InvalidConfiguration();
        }
        lendingAdapter = lending_;
        swapAdapter = swap_;
        executionPolicy = execution_;
        lendingAdapterHash = address(lending_).codehash;
        swapAdapterHash = address(swap_).codehash;
        executionPolicyHash = address(execution_).codehash;
    }

    function createAccount(bytes32 accountPolicyId) external returns (address account) {
        address existing = accountOf[msg.sender];
        if (existing != address(0)) revert AccountAlreadyExists(existing);
        if (
            address(lendingAdapter).codehash != lendingAdapterHash || address(swapAdapter).codehash != swapAdapterHash
                || address(executionPolicy).codehash != executionPolicyHash
        ) revert AdapterChanged();
        account =
            address(new SentinelAccountV2(msg.sender, lendingAdapter, swapAdapter, executionPolicy, accountPolicyId));
        accountOf[msg.sender] = account;
        emit AccountCreated(msg.sender, account, accountPolicyId);
    }
}
