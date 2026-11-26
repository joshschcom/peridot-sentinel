// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {PeridotLendingAdapter} from "../../src/account/PeridotLendingAdapter.sol";
import {SentinelAccountV2, IV2SwapAdapter, IV2ExecutionPolicy} from "../../src/account/SentinelAccountV2.sol";
import {SingleVaultAdapter, ISavingsVault} from "../../src/vault/SingleVaultAdapter.sol";
import {TestnetSavingsVault} from "../../src/vault/TestnetSavingsVault.sol";
import {VaultSentinelAccountV2} from "../../src/vault/VaultSentinelAccountV2.sol";
import {VaultSentinelAccountFactoryV2} from "../../src/vault/VaultSentinelAccountFactoryV2.sol";

interface VaultVm {
    function getCode(string calldata path) external view returns (bytes memory);
    function prank(address who) external;
    function expectRevert(bytes4 selector) external;
    function mockCall(address target, bytes calldata input, bytes calldata output) external;
    function clearMockedCalls() external;
}

interface VaultTestAsset is IERC20Metadata {
    function mint(address, uint256) external;
}

/// @dev Stand-ins for unrelated lending and swap constructor reads in the focused fixture.
contract OtherVenueFixture {
    address public immutable debtAsset;
    address public immutable collateralAsset;
    address public immutable token0;
    address public immutable token1;
    uint256 public constant maxAge = 1 days;
    address public constant controller = address(901);
    address public constant collateralMarket = address(902);
    address public constant debtMarket = address(903);

    constructor(address usdc, address other) {
        debtAsset = usdc;
        collateralAsset = other;
        token0 = usdc;
        token1 = other;
    }
    function requireAccountPolicy(bytes32) external pure {}
}

contract SingleVaultTest {
    VaultVm private constant vm = VaultVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant OP = address(456);
    VaultTestAsset private usdc;
    TestnetSavingsVault private vault;
    SingleVaultAdapter private reader;
    VaultSentinelAccountV2 private acc;
    uint64 private deadline;

    function _deploy(string memory path, bytes memory args) private returns (address instance) {
        bytes memory init = bytes.concat(vm.getCode(path), args);
        assembly ("memory-safe") { instance := create(0, add(init, 32), mload(init)) }
        require(instance.code.length > 0, path);
    }

    function setUp() public {
        usdc = VaultTestAsset(_deploy("../out/TestnetToken.sol/TestnetToken.json", abi.encode("Mock USDC", "mUSDC", 6)));
        address other = _deploy("../out/TestnetToken.sol/TestnetToken.json", abi.encode("Mock OKB", "mWOKB", 18));
        OtherVenueFixture cfg = new OtherVenueFixture(address(usdc), other);
        vault = new TestnetSavingsVault(usdc);
        reader = new SingleVaultAdapter(ISavingsVault(address(vault)), usdc);
        VaultSentinelAccountFactoryV2 factory = VaultSentinelAccountFactoryV2(
            _deploy(
                "out/VaultSentinelAccountFactoryV2.sol/VaultSentinelAccountFactoryV2.json",
                abi.encode(cfg, cfg, cfg, reader)
            )
        );
        acc = VaultSentinelAccountV2(factory.createAccount(bytes32(uint256(1))));
        deadline = uint64(block.timestamp + 1 hours);
        usdc.mint(address(acc), 200e6);
    }

    function _limits() private {
        acc.setVaultDepositLimits(120e6, 0.5e18);
    }

    function _grant(uint8 op, address token, uint256 single, uint256 limit) private {
        acc.setGrant(OP, address(reader), op, token, single, limit, deadline);
    }

    function _remaining(uint8 op, address token) private view returns (uint256 remaining) {
        (, remaining,) = acc.grants(OP, address(reader), op, token);
    }

    function testActualShareAndAssetDeltasAndExactWithdraw() public {
        _limits();
        uint256 first = acc.depositToVault(40e6, 40e6, deadline);
        require(first == 40e6 && usdc.allowance(address(acc), address(vault)) == 0);
        usdc.mint(address(vault), 2e6); // Actual mock inventory donation changes assets per share.
        uint256 second = vault.previewDeposit(20e6);
        require(acc.depositToVault(20e6, second, deadline) == second && second < 20e6);
        (uint256 shares, uint256 claim, uint256 liquidShares, uint256 liquidAssets) = acc.vaultPosition();
        require(shares == first + second && shares == liquidShares && claim == liquidAssets);
        require(claim > shares && claim <= 62e6 && usdc.balanceOf(address(reader)) == 0);
        uint256 burn = vault.previewWithdraw(5e6);
        _grant(8, address(vault), 5e6, 6e6);
        vm.prank(OP);
        require(acc.withdrawFromVault(5e6, burn, deadline) == burn);
        require(_remaining(8, address(vault)) == 6e6 - burn && usdc.balanceOf(OP) == 0);
        uint256 remainingShares = vault.balanceOf(address(acc));
        uint256 assets = vault.previewRedeem(remainingShares);
        require(acc.redeemFromVault(remainingShares, assets, deadline) == assets);
        require(usdc.balanceOf(address(acc)) == 145e6 + assets && vault.balanceOf(address(acc)) == 0);
        require(
            usdc.allowance(address(acc), address(vault)) == 0 && vault.allowance(address(acc), address(reader)) == 0
        );
    }

    function testOwnerLimitsAndOperatorGrantsRollbackAndGlobalRevoke() public {
        vm.expectRevert(VaultSentinelAccountV2.VaultDepositLimit.selector);
        acc.depositToVault(1e6, 1, deadline);
        vm.prank(OP);
        vm.expectRevert(SentinelAccountV2.OwnerOnly.selector);
        acc.setVaultDepositLimits(200e6, 1);
        acc.setVaultDepositLimits(30e6, 1e18);
        _grant(6, address(usdc), 20e6, 40e6);
        _grant(7, address(vault), 20e6, 40e6);
        vm.prank(OP);
        acc.depositToVault(20e6, 20e6, deadline);
        vm.prank(OP);
        vm.expectRevert(VaultSentinelAccountV2.VaultDepositLimit.selector);
        acc.depositToVault(20e6, 1, deadline);
        require(_remaining(6, address(usdc)) == 20e6 && acc.operatorCount() == 1);
        acc.setVaultDepositLimits(200e6, 1.1e18);
        vm.prank(OP);
        vm.expectRevert(VaultSentinelAccountV2.VaultBounds.selector);
        acc.depositToVault(1e6, 1, deadline);
        vm.prank(OP);
        vm.expectRevert(SentinelAccountV2.OwnerOnly.selector);
        acc.exitVaultShares(1e6);
        acc.revokeAllOperators();
        vm.prank(OP);
        vm.expectRevert(SentinelAccountV2.OperatorNotAuthorized.selector);
        acc.redeemFromVault(1e6, 1, deadline);
        require(acc.operatorCount() == 0 && _remaining(6, address(usdc)) == 0);
    }

    function testMaximaMinimaExpiryAndInKindExit() public {
        _limits();
        acc.depositToVault(40e6, 40e6, deadline);
        vm.expectRevert(VaultSentinelAccountV2.VaultBounds.selector);
        acc.redeemFromVault(1e6, 2e6, deadline);
        vm.expectRevert(VaultSentinelAccountV2.VaultBounds.selector);
        acc.withdrawFromVault(5e6, 1e6, deadline);
        vm.expectRevert(SingleVaultAdapter.VaultCapacity.selector);
        acc.withdrawFromVault(41e6, 41e6, deadline);
        vm.expectRevert(SingleVaultAdapter.VaultCapacity.selector);
        acc.redeemFromVault(41e6, 1, deadline);
        vm.expectRevert(SentinelAccountV2.DeadlineExpired.selector);
        acc.depositToVault(1e6, 1, 0);
        vm.mockCall(address(vault), abi.encodeCall(vault.getImplementation, ()), abi.encode(address(44)));
        vm.expectRevert(SingleVaultAdapter.InvalidVaultIdentity.selector);
        acc.depositToVault(1e6, 1, deadline);
        acc.exitVaultShares(40e6);
        require(vault.balanceOf(address(this)) == 40e6 && vault.balanceOf(address(acc)) == 0);
    }

    function testRejectsDifferentAssetAndMissingSettlement() public {
        vm.expectRevert(SingleVaultAdapter.InvalidVaultIdentity.selector);
        new SingleVaultAdapter(ISavingsVault(address(vault)), IERC20Metadata(address(vault)));
        vm.mockCall(address(vault), abi.encodeCall(vault.decimals, ()), abi.encode(uint8(18)));
        vm.expectRevert(SingleVaultAdapter.InvalidVaultIdentity.selector);
        new SingleVaultAdapter(ISavingsVault(address(vault)), usdc);
        vm.clearMockedCalls();
        _limits();
        vm.mockCall(address(vault), abi.encodeCall(vault.deposit, (1e6, address(acc))), abi.encode(1e6));
        vm.expectRevert(SentinelAccountV2.UnexpectedSettlement.selector);
        acc.depositToVault(1e6, 1, deadline);
        require(usdc.allowance(address(acc), address(vault)) == 0 && usdc.balanceOf(address(acc)) == 200e6);
    }

    function testEmergencyEpochRevokesEveryVaultEntryAndLeavesOwnerExit() public {
        _limits();
        acc.depositToVault(10e6, 10e6, deadline);
        _grant(6, address(usdc), 5e6, 10e6);
        _grant(7, address(vault), 5e6, 10e6);
        _grant(8, address(vault), 5e6, 10e6);
        require(acc.operatorCount() == 1);
        acc.revokeAllOperators();
        vm.prank(OP);
        vm.expectRevert(SentinelAccountV2.OperatorNotAuthorized.selector);
        acc.depositToVault(1e6, 1e6, deadline);
        vm.prank(OP);
        vm.expectRevert(SentinelAccountV2.OperatorNotAuthorized.selector);
        acc.redeemFromVault(1e6, 1e6, deadline);
        vm.prank(OP);
        vm.expectRevert(SentinelAccountV2.OperatorNotAuthorized.selector);
        acc.withdrawFromVault(1e6, 1e6, deadline);
        require(
            usdc.allowance(address(acc), address(reader)) == 0 && vault.allowance(address(acc), address(reader)) == 0
        );
        require(usdc.allowance(address(acc), OP) == 0 && vault.allowance(address(acc), OP) == 0);
        acc.setVaultDepositLimits(0, 0);
        acc.withdrawFromVault(4e6, 4e6, deadline);
        acc.exitVaultShares(6e6);
        require(vault.balanceOf(address(this)) == 6e6 && vault.balanceOf(address(acc)) == 0);
    }
}
