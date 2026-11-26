// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PeridotLendingAdapter} from "../account/PeridotLendingAdapter.sol";
import {IV2SwapAdapter, IV2ExecutionPolicy} from "../account/SentinelAccountV2.sol";
import {SingleVaultAdapter} from "./SingleVaultAdapter.sol";
import {VaultSentinelAccountV2} from "./VaultSentinelAccountV2.sol";

contract VaultSentinelAccountFactoryV2 {
    PeridotLendingAdapter private immutable lendingAdapter;
    IV2SwapAdapter private immutable swapAdapter;
    IV2ExecutionPolicy private immutable executionPolicy;
    SingleVaultAdapter public immutable vaultAdapter;
    bytes32 private immutable targetHash;
    mapping(address owner => address account) public accountOf;
    error InvalidConfiguration();
    error AccountAlreadyExists(address account);
    event AccountCreated(address indexed owner, address indexed account, bytes32 indexed policyId);

    constructor(
        PeridotLendingAdapter lending_,
        IV2SwapAdapter swap_,
        IV2ExecutionPolicy execution_,
        SingleVaultAdapter vault_
    ) {
        if (
            (block.chainid != 1952 && block.chainid != 31337) || address(lending_).code.length == 0
                || address(swap_).code.length == 0 || address(execution_).code.length == 0
                || address(vault_).code.length == 0
        ) revert InvalidConfiguration();
        lendingAdapter = lending_;
        swapAdapter = swap_;
        executionPolicy = execution_;
        vaultAdapter = vault_;
        targetHash = _targetHash();
    }

    function _targetHash() private view returns (bytes32) {
        return keccak256(
            abi.encode(
                address(lendingAdapter).codehash,
                address(swapAdapter).codehash,
                address(executionPolicy).codehash,
                address(vaultAdapter).codehash
            )
        );
    }

    function createAccount(bytes32 policyId) external returns (address account) {
        if (accountOf[msg.sender] != address(0)) revert AccountAlreadyExists(accountOf[msg.sender]);
        if (_targetHash() != targetHash) revert InvalidConfiguration();
        account = address(
            new VaultSentinelAccountV2(msg.sender, lendingAdapter, swapAdapter, executionPolicy, policyId, vaultAdapter)
        );
        accountOf[msg.sender] = account;
        emit AccountCreated(msg.sender, account, policyId);
    }
}
