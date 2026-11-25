// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @dev This zero-delay product and its mocks are restricted to the two development chains.
abstract contract TestProfile {
    error UnsupportedChain(uint256 chainId);

    constructor() {
        if (block.chainid != 1952 && block.chainid != 31337) revert UnsupportedChain(block.chainid);
    }
}
