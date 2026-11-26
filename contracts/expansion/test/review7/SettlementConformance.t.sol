// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReviewFixture} from "./ReviewFixture.sol";
import {SentinelAccountV2} from "../../src/account/SentinelAccountV2.sol";

contract SettlementConformanceTest is ReviewFixture {
    address constant OP = address(0x301);
    uint64 constant DEADLINE = type(uint64).max;

    function setUp() public {
        _setup(address(this));
    }

    function testFuzz_VaultPermitTracksExactDebitAndRecipient(uint64 raw) external {
        uint256 amount = 1 + uint256(raw) % 500e6;
        account.setGrant(OP, address(binding), 6, address(asset), amount, 2 * amount, DEADLINE);
        asset.enableObserver();
        vm.prank(OP);
        require(account.depositToVault(amount, amount, DEADLINE) == amount);
        require(asset.nestedResult() == SentinelAccountV2.ReentrantOperation.selector, "reentry lock");
        require(asset.observedAllowance() == amount, "approval at transfer");
        require(asset.allowance(address(account), address(vault)) == 0, "approval after");
        (, uint256 remaining,) = account.grants(OP, address(binding), 6, address(asset));
        require(remaining == amount);
        require(vault.balanceOf(address(account)) == amount && vault.balanceOf(OP) == 0 && asset.balanceOf(OP) == 0);
    }

    function testNonconformingApprovalsAndFailedCleanupRollback() external {
        uint256 amount = 1e6;
        account.setGrant(OP, address(binding), 6, address(asset), amount, amount, DEADLINE);
        bytes memory set = abi.encodeCall(asset.approve, (address(vault), amount));
        // ERC-20 false, affirmative without updating allowance, and a legacy empty return.
        _refuse(set, abi.encode(false), true);
        _refuse(set, abi.encode(true), true);
        _refuse(set, hex"", false);
        // Failure after the vault has accepted a deposit must roll back the entire transaction.
        _refuse(abi.encodeCall(asset.approve, (address(vault), 0)), abi.encode(false), true);
    }

    function _refuse(bytes memory callData, bytes memory response, bool typedError) private {
        vm.mockCall(address(asset), callData, response);
        vm.prank(OP);
        if (typedError) vm.expectRevert(SentinelAccountV2.TokenOperationFailed.selector);
        else vm.expectRevert();
        account.depositToVault(1e6, 1e6, DEADLINE);
        vm.clearMockedCalls();
        (, uint256 remaining,) = account.grants(OP, address(binding), 6, address(asset));
        require(remaining == 1e6 && vault.totalAssets() == 0 && vault.totalSupply() == 0);
        require(asset.balanceOf(address(account)) == INITIAL && asset.allowance(address(account), address(vault)) == 0);
    }
}
