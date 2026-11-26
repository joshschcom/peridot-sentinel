// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Inventory-backed ERC-4626 development fixture for a valueless six-decimal token.
/// The fixture has no yield strategy. Direct donations increase assets per share.
contract TestnetSavingsVault is ERC20 {
    IERC20Metadata public immutable asset;
    uint256 public constant CAP = 10_000_000e6;

    error TestnetOnly();
    error VaultLimit();
    error TransferFailed();
    event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(
        address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares
    );

    constructor(IERC20Metadata asset_) ERC20("Testnet mock savings USDC", "msUSDC") {
        if (block.chainid != 1952 && block.chainid != 31337) revert TestnetOnly();
        require(address(asset_).code.length != 0 && asset_.decimals() == 6);
        asset = asset_;
    }

    function getImplementation() external view returns (address) {
        return address(this);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function totalAssets() public view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        return Math.mulDiv(assets, totalSupply() + 1, totalAssets() + 1);
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return Math.mulDiv(shares, totalAssets() + 1, totalSupply() + 1);
    }

    function maxDeposit(address) public view returns (uint256) {
        uint256 cash = totalAssets();
        return cash >= CAP ? 0 : CAP - cash;
    }

    function maxMint(address receiver) public view returns (uint256) {
        return convertToShares(maxDeposit(receiver));
    }

    function maxWithdraw(address owner) public view returns (uint256) {
        return convertToAssets(balanceOf(owner));
    }

    function maxRedeem(address owner) public view returns (uint256) {
        return balanceOf(owner);
    }

    function previewDeposit(uint256 assets) public view returns (uint256) {
        return convertToShares(assets);
    }

    function previewRedeem(uint256 shares) public view returns (uint256) {
        return convertToAssets(shares);
    }

    function previewMint(uint256 shares) public view returns (uint256) {
        return Math.mulDiv(shares, totalAssets() + 1, totalSupply() + 1, Math.Rounding.Ceil);
    }

    function previewWithdraw(uint256 assets) public view returns (uint256) {
        return Math.mulDiv(assets, totalSupply() + 1, totalAssets() + 1, Math.Rounding.Ceil);
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        if (assets > maxDeposit(receiver)) revert VaultLimit();
        shares = previewDeposit(assets);
        _deposit(assets, shares, receiver);
    }

    function mint(uint256 shares, address receiver) external returns (uint256 assets) {
        if (shares > maxMint(receiver)) revert VaultLimit();
        assets = previewMint(shares);
        _deposit(assets, shares, receiver);
    }

    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets) {
        if (shares > maxRedeem(owner)) revert VaultLimit();
        assets = previewRedeem(shares);
        _withdraw(assets, shares, receiver, owner);
    }

    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares) {
        if (assets > maxWithdraw(owner)) revert VaultLimit();
        shares = previewWithdraw(assets);
        _withdraw(assets, shares, receiver, owner);
    }

    function _deposit(uint256 assets, uint256 shares, address receiver) private {
        if (assets != 0 && shares == 0) revert VaultLimit();
        if (!asset.transferFrom(msg.sender, address(this), assets)) revert TransferFailed();
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function _withdraw(uint256 assets, uint256 shares, address receiver, address owner) private {
        if (owner != msg.sender) _spendAllowance(owner, msg.sender, shares);
        _burn(owner, shares);
        if (!asset.transfer(receiver, assets)) revert TransferFailed();
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }
}
