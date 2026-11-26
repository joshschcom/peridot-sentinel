// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SentinelAccountV2, IV2SwapAdapter, IV2ExecutionPolicy} from "../account/SentinelAccountV2.sol";
import {PeridotLendingAdapter} from "../account/PeridotLendingAdapter.sol";
import {ISavingsVault, SingleVaultAdapter} from "./SingleVaultAdapter.sol";

/// @notice Optional v2 account profile. It holds its own share position and uses the base grant book.
contract VaultSentinelAccountV2 is SentinelAccountV2 {
    uint8 public constant VAULT_DEPOSIT = 6;
    uint8 public constant VAULT_REDEEM = 7;
    uint8 public constant VAULT_WITHDRAW = 8;
    SingleVaultAdapter public immutable vaultAdapter;
    bytes32 public immutable vaultAdapterHash;
    ISavingsVault public immutable vault;
    IERC20 public immutable vaultAsset;
    uint256 public maxVaultPositionAssets;
    uint256 public minVaultSharesPerAssetWad;

    error VaultDepositLimit();
    error VaultBounds();
    event VaultLimitsSet(uint256 maxPositionAssets, uint256 minSharesPerAssetWad);
    event VaultSettled(
        address indexed operator, address indexed vault, uint8 indexed operation, uint256 assets, uint256 shares
    );
    event VaultSharesExited(address indexed owner, uint256 shares);

    constructor(
        address owner_,
        PeridotLendingAdapter lending_,
        IV2SwapAdapter swap_,
        IV2ExecutionPolicy execution_,
        bytes32 policy_,
        SingleVaultAdapter adapter_
    ) SentinelAccountV2(owner_, lending_, swap_, execution_, policy_) {
        if (address(adapter_).code.length == 0) revert InvalidConfiguration();
        adapter_.checkIdentity();
        vaultAdapter = adapter_;
        vaultAdapterHash = address(adapter_).codehash;
        vault = adapter_.vault();
        vaultAsset = adapter_.asset();
        address underlying = address(vaultAsset);
        if (underlying != token0 && underlying != token1 && underlying != debtAsset && underlying != collateralAsset) {
            revert InvalidAsset();
        }
        if (
            address(vault) == token0 || address(vault) == token1 || address(vault) == debtAsset
                || address(vault) == collateralAsset || address(vault) == address(collateralMarket)
                || address(vault) == address(debtMarket)
        ) revert InvalidAsset();
    }

    /// @notice Zero cap disables deposits. Both assets and shares use six decimals.
    function setVaultDepositLimits(uint256 maxPositionAssets, uint256 minSharesPerAssetWad) external onlyOwner {
        if (maxPositionAssets != 0 && minSharesPerAssetWad == 0) revert VaultBounds();
        maxVaultPositionAssets = maxPositionAssets;
        minVaultSharesPerAssetWad = minSharesPerAssetWad;
        emit VaultLimitsSet(maxPositionAssets, minSharesPerAssetWad);
    }

    function _supportedGrant(address adapter, uint8 op, address inputAsset) internal view override returns (bool) {
        if (adapter != address(vaultAdapter)) return super._supportedGrant(adapter, op, inputAsset);
        if (op == VAULT_DEPOSIT) return inputAsset == address(vaultAsset);
        return (op == VAULT_REDEEM || op == VAULT_WITHDRAW) && inputAsset == address(vault);
    }

    function vaultPosition()
        external
        view
        returns (uint256 shares, uint256 claimAssets, uint256 liquidShares, uint256 liquidAssets)
    {
        _checkPin(address(vaultAdapter), vaultAdapterHash);
        return vaultAdapter.position(address(this));
    }

    function _beforeVault(uint64 deadline) private view {
        if (block.timestamp > deadline) revert DeadlineExpired();
        _checkPin(address(vaultAdapter), vaultAdapterHash);
    }

    function depositToVault(uint256 assets, uint256 minShares, uint64 deadline)
        external
        locked
        returns (uint256 shares)
    {
        _beforeVault(deadline);
        _charge(address(vaultAdapter), VAULT_DEPOSIT, address(vaultAsset), assets);
        uint256 expected = vaultAdapter.quoteDeposit(address(this), assets);
        uint256 beforeShares = vault.balanceOf(address(this));
        uint256 beforeAssets = vaultAsset.balanceOf(address(this));
        if (beforeAssets < assets) revert InsufficientInput();
        if (vault.convertToAssets(beforeShares) + assets > maxVaultPositionAssets) revert VaultDepositLimit();
        uint256 floor = Math.mulDiv(assets, minVaultSharesPerAssetWad, 1e18, Math.Rounding.Ceil);
        if (minShares == 0 || minShares > expected || expected < floor) revert VaultBounds();
        _approve(address(vaultAsset), address(vault), assets);
        shares = vault.deposit(assets, address(this));
        _approve(address(vaultAsset), address(vault), 0);
        uint256 afterShares = vault.balanceOf(address(this));
        if (
            shares < expected || afterShares != beforeShares + shares
                || vaultAsset.balanceOf(address(this)) != beforeAssets - assets
        ) revert UnexpectedSettlement();
        if (vault.convertToAssets(afterShares) > maxVaultPositionAssets) revert VaultDepositLimit();
        emit VaultSettled(msg.sender, address(vault), VAULT_DEPOSIT, assets, shares);
    }

    function redeemFromVault(uint256 shares, uint256 minAssets, uint64 deadline)
        external
        locked
        returns (uint256 assets)
    {
        _beforeVault(deadline);
        _charge(address(vaultAdapter), VAULT_REDEEM, address(vault), shares);
        uint256 expected = vaultAdapter.quoteRedeem(address(this), shares);
        if (minAssets == 0 || minAssets > expected) revert VaultBounds();
        (uint256 beforeAssets, uint256 beforeShares) =
            (vaultAsset.balanceOf(address(this)), vault.balanceOf(address(this)));
        assets = vault.redeem(shares, address(this), address(this));
        if (assets < expected) revert UnexpectedSettlement();
        _checkExit(beforeAssets, beforeShares, assets, shares, VAULT_REDEEM);
    }

    function withdrawFromVault(uint256 assets, uint256 maxShares, uint64 deadline)
        external
        locked
        returns (uint256 shares)
    {
        _beforeVault(deadline);
        uint256 expected = vaultAdapter.quoteWithdraw(address(this), assets);
        if (expected > maxShares) revert VaultBounds();
        _charge(address(vaultAdapter), VAULT_WITHDRAW, address(vault), expected);
        (uint256 beforeAssets, uint256 beforeShares) =
            (vaultAsset.balanceOf(address(this)), vault.balanceOf(address(this)));
        shares = vault.withdraw(assets, address(this), address(this));
        // The supported vault burns the exact, rounded-up preview in the same transaction.
        if (shares != expected) revert UnexpectedSettlement();
        _checkExit(beforeAssets, beforeShares, assets, shares, VAULT_WITHDRAW);
    }

    function _checkExit(uint256 beforeAssets, uint256 beforeShares, uint256 assets, uint256 shares, uint8 operation)
        private
    {
        if (
            vault.balanceOf(address(this)) != beforeShares - shares
                || vaultAsset.balanceOf(address(this)) != beforeAssets + assets
        ) revert UnexpectedSettlement();
        emit VaultSettled(msg.sender, address(vault), operation, assets, shares);
    }

    /// @notice Owners can take their shares in kind even during a circuit outage, liquidity cap or vault upgrade.
    function exitVaultShares(uint256 shares) external onlyOwner locked {
        if (shares == 0) revert InvalidAmount();
        uint256 beforeAccount = vault.balanceOf(address(this));
        uint256 beforeOwner = vault.balanceOf(owner);
        if (
            !vault.transfer(owner, shares) || vault.balanceOf(address(this)) != beforeAccount - shares
                || vault.balanceOf(owner) != beforeOwner + shares
        ) revert UnexpectedSettlement();
        emit VaultSharesExited(owner, shares);
    }
}
