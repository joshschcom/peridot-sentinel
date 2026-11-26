// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ForkLiquidityAccount} from "../../src/lp7/ForkLiquidityAccount.sol";

interface VmLp {
    function chainId(uint256) external;
    function prank(address) external;
    function expectRevert(bytes4) external;
}

/// @dev Deterministic chain and venue admission checks on a local test EVM.
contract ForkLiquidityAccountTest {
    VmLp private constant vm = VmLp(address(uint160(uint256(keccak256("hevm cheat code")))));

    function testRejectsPublicMainnetAndTestnet() external {
        vm.chainId(196);
        vm.expectRevert(ForkLiquidityAccount.ForkOnly.selector);
        new ForkLiquidityAccount();
        vm.chainId(1952);
        vm.expectRevert(ForkLiquidityAccount.ForkOnly.selector);
        new ForkLiquidityAccount();
    }

    function testRejectsMissingVenue() external {
        vm.chainId(31337);
        // This isolated local fixture contains no mainnet venue code.
        vm.expectRevert(ForkLiquidityAccount.Identity.selector);
        new ForkLiquidityAccount();
    }
}
