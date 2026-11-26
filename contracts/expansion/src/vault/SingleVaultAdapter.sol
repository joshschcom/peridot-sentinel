// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface ISavingsVault is IERC20Metadata {
    function asset() external view returns (address);
    function getImplementation() external view returns (address);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function maxDeposit(address receiver) external view returns (uint256);
    function maxWithdraw(address owner) external view returns (uint256);
    function maxRedeem(address owner) external view returns (uint256);
    function previewDeposit(uint256 assets) external view returns (uint256);
    function previewWithdraw(uint256 assets) external view returns (uint256);
    function previewRedeem(uint256 shares) external view returns (uint256);
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);
}

/// @notice Immutable, read-only binding to a single six-decimal Spark-compatible savings vault.
contract SingleVaultAdapter {
    ISavingsVault public immutable vault;
    IERC20Metadata public immutable asset;
    bytes32 public immutable vaultCodeHash;
    bytes32 public immutable assetCodeHash;
    address public immutable implementation;
    bytes32 public immutable implementationCodeHash;

    error InvalidVaultIdentity();
    error VaultCapacity();
    error VaultQuote();

    constructor(ISavingsVault vault_, IERC20Metadata asset_) {
        if (block.chainid != 1952 && block.chainid != 31337) revert InvalidVaultIdentity();
        if (
            address(vault_) == address(asset_) || address(vault_).code.length == 0 || address(asset_).code.length == 0
                || vault_.asset() != address(asset_) || vault_.decimals() != 6 || asset_.decimals() != 6
        ) revert InvalidVaultIdentity();
        address impl = vault_.getImplementation();
        if (impl.code.length == 0) revert InvalidVaultIdentity();
        vault = vault_;
        asset = asset_;
        vaultCodeHash = address(vault_).codehash;
        assetCodeHash = address(asset_).codehash;
        implementation = impl;
        implementationCodeHash = impl.codehash;
    }

    function checkIdentity() public view {
        if (
            address(vault).codehash != vaultCodeHash || address(asset).codehash != assetCodeHash
                || vault.asset() != address(asset) || vault.decimals() != 6 || asset.decimals() != 6
                || vault.getImplementation() != implementation || implementation.codehash != implementationCodeHash
        ) {
            revert InvalidVaultIdentity();
        }
    }

    function position(address account)
        external
        view
        returns (uint256 shares, uint256 claimAssets, uint256 liquidShares, uint256 liquidAssets)
    {
        checkIdentity();
        shares = vault.balanceOf(account);
        claimAssets = vault.convertToAssets(shares);
        liquidShares = vault.maxRedeem(account);
        liquidAssets = vault.maxWithdraw(account);
    }

    function quoteDeposit(address account, uint256 assets) external view returns (uint256 shares) {
        checkIdentity();
        if (assets > vault.maxDeposit(account)) revert VaultCapacity();
        shares = vault.previewDeposit(assets);
        if (assets == 0 || shares == 0) revert VaultQuote();
    }

    function quoteRedeem(address account, uint256 shares) external view returns (uint256 assets) {
        checkIdentity();
        if (shares > vault.maxRedeem(account)) revert VaultCapacity();
        assets = vault.previewRedeem(shares);
        if (shares == 0 || assets == 0) revert VaultQuote();
    }

    function quoteWithdraw(address account, uint256 assets) external view returns (uint256 shares) {
        checkIdentity();
        if (assets > vault.maxWithdraw(account)) revert VaultCapacity();
        shares = vault.previewWithdraw(assets);
        if (assets == 0 || shares == 0) revert VaultQuote();
    }
}
