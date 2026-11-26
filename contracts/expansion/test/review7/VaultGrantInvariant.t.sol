// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReviewFixture, ReviewVm} from "./ReviewFixture.sol";
import {SentinelAccountV2} from "../../src/account/SentinelAccountV2.sol";
import {VaultSentinelAccountV2} from "../../src/vault/VaultSentinelAccountV2.sol";

/// @dev Two synthetic operators share a real account but maintain independent grant models.
contract VaultGrantHandler {
    ReviewVm private constant vm = ReviewVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct Model {
        uint256 single;
        uint256 remaining;
        uint64 expiry;
    }

    VaultSentinelAccountV2 private immutable account;
    address private immutable binding;
    address private immutable asset;
    mapping(address actor => Model) public model;
    uint256 public deposited;
    uint256 public completed;
    uint256 public rejected;
    uint256 public epochChanges;
    address constant FIRST = address(0x101);
    address constant SECOND = address(0x202);

    constructor(VaultSentinelAccountV2 account_) {
        account = account_;
        binding = address(account_.vaultAdapter());
        asset = address(account_.vaultAsset());
    }

    function actor(bool second) public pure returns (address) {
        return second ? SECOND : FIRST;
    }

    function replace(bool second, uint32 n, uint32 extra) external {
        address who = actor(second);
        uint256 single = 1 + uint256(n) % 1e6;
        uint256 budget = single + uint256(extra) % 3e6;
        uint64 expiry = uint64(block.timestamp + 120);
        vm.prank(account.owner());
        account.setGrant(who, binding, 6, asset, single, budget, expiry);
        model[who] = Model(single, budget, expiry);
    }

    function revoke(bool second) external {
        address who = actor(second);
        vm.prank(account.owner());
        account.revokeGrant(who, binding, 6, asset);
        delete model[who];
    }

    function emergency() external {
        vm.prank(account.owner());
        account.revokeAllOperators();
        delete model[FIRST];
        delete model[SECOND];
        ++epochChanges;
    }

    function advance(uint16 seconds_) external {
        vm.warp(block.timestamp + 1 + seconds_ % 180);
    }

    function spend(bool second, uint32 n, bool requireExtraShare) external {
        address who = actor(second);
        Model storage grant = model[who];
        uint256 amount = 1 + uint256(n) % 1e6;
        uint256 minShares = amount + (requireExtraShare ? 1 : 0);
        bytes4 error;
        if (grant.expiry == 0) error = SentinelAccountV2.OperatorNotAuthorized.selector;
        else if (block.timestamp >= grant.expiry) error = SentinelAccountV2.OperatorExpired.selector;
        else if (amount > grant.single || amount > grant.remaining) error = SentinelAccountV2.BudgetExceeded.selector;
        else if (requireExtraShare) error = VaultSentinelAccountV2.VaultBounds.selector;

        vm.prank(who);
        try account.depositToVault(amount, minShares, type(uint64).max) returns (uint256 shares) {
            require(error == bytes4(0) && shares == amount, "unexpected settlement");
            grant.remaining -= amount;
            deposited += amount;
            ++completed;
        } catch (bytes memory data) {
            require(error != bytes4(0) && bytes4(data) == error, "unexpected rejection");
            ++rejected;
        }
    }
}

contract VaultGrantInvariantTest is ReviewFixture {
    VaultGrantHandler private handler;

    function setUp() public {
        _setup(address(this));
        handler = new VaultGrantHandler(account);
        // Fixed prefix guarantees real spends, downstream rollback and revoked access in every run.
        handler.replace(false, 9, 8);
        handler.spend(false, 3, false);
        handler.spend(false, 3, true);
        handler.emergency();
        handler.spend(false, 0, false);
        handler.replace(true, 8, 10);
    }

    function targetContracts() public view returns (address[] memory contracts_) {
        contracts_ = new address[](1);
        contracts_[0] = address(handler);
    }

    function invariant_authorizationMatchesIndependentModel() public view {
        uint256 count;
        for (uint256 i; i < 2; ++i) {
            address who = handler.actor(i == 1);
            (uint256 expectedMax, uint256 expectedRemaining, uint64 expectedExpiry) = handler.model(who);
            (uint256 max, uint256 remaining, uint64 expiry) = account.grants(who, address(binding), 6, address(asset));
            require(max == expectedMax && remaining == expectedRemaining && expiry == expectedExpiry, "grant");
            if (expiry != 0) {
                ++count;
                bool listed;
                for (uint256 j; j < account.operatorCount(); ++j) {
                    if (account.operatorAt(j) == who) listed = true;
                }
                require(listed, "missing operator");
            }
            require(asset.balanceOf(who) == 0 && vault.balanceOf(who) == 0, "operator received assets");
        }
        require(account.operatorCount() == count, "enumeration");
        require(asset.allowance(address(account), address(vault)) == 0, "allowance");
        require(asset.balanceOf(address(account)) + handler.deposited() == INITIAL, "idle cash");
        require(vault.balanceOf(address(account)) == handler.deposited(), "account shares");
        require(asset.balanceOf(address(vault)) == handler.deposited(), "vault cash");
        require(handler.completed() > 0 && handler.rejected() >= 2 && handler.epochChanges() > 0, "reachability");
    }
}
