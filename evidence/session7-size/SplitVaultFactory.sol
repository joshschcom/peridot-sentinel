// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PeridotLendingAdapter} from "../account/PeridotLendingAdapter.sol";
import {IV2SwapAdapter, IV2ExecutionPolicy} from "../account/SentinelAccountV2.sol";
import {VaultSentinelAccountV2} from "../vault/VaultSentinelAccountV2.sol";
import {SingleVaultAdapter} from "../vault/SingleVaultAdapter.sol";

/// @dev Test fixture. Its deployed code is STOP followed by a fragment of the reviewed creation image.
contract CreationFragment {
    constructor(bytes memory image, uint256 start, uint256 count) {
        require(count > 0 && count < 24576 && start + count <= image.length);
        assembly ("memory-safe") {
            // The constructor owns this memory and ends immediately after writing the prefix.
            let prefix := add(add(image, 31), start)
            mstore8(prefix, 0)
            return(prefix, add(count, 1))
        }
    }
}

/// @dev Compile/fork experiment only. Keep all owner-facing construction atomic and typed.
contract SplitVaultFactory {
    PeridotLendingAdapter private immutable lendingAdapter;
    IV2SwapAdapter private immutable swapAdapter;
    IV2ExecutionPolicy private immutable executionPolicy;
    SingleVaultAdapter public immutable vaultAdapter;
    bytes32 private immutable targetHash;
    address private immutable first;
    address private immutable second;
    bytes32 private immutable imageHash;
    mapping(address owner => address account) public accountOf;

    error InvalidConfiguration();
    error AccountAlreadyExists(address account);
    event AccountCreated(address indexed owner, address indexed account, bytes32 indexed policyId);

    constructor(PeridotLendingAdapter lending, IV2SwapAdapter swap, IV2ExecutionPolicy execution, SingleVaultAdapter vault) {
        if ((block.chainid != 1952 && block.chainid != 31337) || address(lending).code.length == 0
            || address(swap).code.length == 0 || address(execution).code.length == 0 || address(vault).code.length == 0)
            revert InvalidConfiguration();
        lendingAdapter = lending;
        swapAdapter = swap;
        executionPolicy = execution;
        vaultAdapter = vault;
        targetHash = _targetHash();

        bytes memory image = type(VaultSentinelAccountV2).creationCode;
        imageHash = keccak256(image);
        uint256 half = image.length / 2;
        first = address(new CreationFragment(image, 0, half));
        second = address(new CreationFragment(image, half, image.length - half));
    }

    function _targetHash() private view returns (bytes32) {
        return keccak256(abi.encode(address(lendingAdapter).codehash, address(swapAdapter).codehash,
            address(executionPolicy).codehash, address(vaultAdapter).codehash));
    }

    function createAccount(bytes32 policyId) external returns (address account) {
        if (accountOf[msg.sender] != address(0)) revert AccountAlreadyExists(accountOf[msg.sender]);
        if (_targetHash() != targetHash) revert InvalidConfiguration();
        address a = first;
        address b = second;
        uint256 lenA = a.code.length - 1;
        uint256 lenB = b.code.length - 1;
        bytes memory image = new bytes(lenA + lenB);
        assembly ("memory-safe") {
            extcodecopy(a, add(image, 32), 1, lenA)
            extcodecopy(b, add(add(image, 32), lenA), 1, lenB)
        }
        if (keccak256(image) != imageHash) revert InvalidConfiguration();
        bytes memory init = bytes.concat(image, abi.encode(msg.sender, lendingAdapter, swapAdapter, executionPolicy, policyId, vaultAdapter));
        assembly ("memory-safe") {
            account := create(0, add(init, 32), mload(init))
            if iszero(account) {
                let p := mload(0x40)
                returndatacopy(p, 0, returndatasize())
                revert(p, returndatasize())
            }
        }
        accountOf[msg.sender] = account;
        emit AccountCreated(msg.sender, account, policyId);
    }
}
