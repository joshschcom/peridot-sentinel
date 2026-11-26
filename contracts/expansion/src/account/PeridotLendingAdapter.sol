// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IV2MarketFactory {
    function isMarket(address controller) external view returns (bool);
}

interface IV2MarketBook {
    function balanceOf(address account) external view returns (uint256);
    function borrowBalanceStored(address account) external view returns (uint256);
    function borrowBalanceCurrent(address account) external returns (uint256);
    function exchangeRateStored() external view returns (uint256);
    function exchangeRateCurrent() external returns (uint256);
    function mint(uint256 amount) external returns (uint256);
    function redeem(uint256 shares) external returns (uint256);
    function borrow(uint256 amount) external returns (uint256);
    function repayBorrow(uint256 amount) external returns (uint256);
}

interface IV2LendingRegistry {
    function requirePolicy(bytes32 id, uint8 kind) external view returns (address processor, uint256 circuitId);
}

interface IV2LendingPolicy {
    function enforce(bytes32 id, uint8 kind, uint8 op, bool fresh, uint256 ltv, bool cashOk) external view;
}

interface IV2IsolatedController {
    function collateralMarket() external view returns (IV2MarketBook);
    function debtMarket() external view returns (IV2MarketBook);
    function collateralAsset() external view returns (address);
    function debtAsset() external view returns (address);
    function registry() external view returns (IV2LendingRegistry);
    function adapter() external view returns (IV2LendingPolicy);
    function collateralEntered(address account) external view returns (bool);
    function enterMarkets(address[] calldata markets) external returns (uint256[] memory codes);
    function accrue() external;
    function previewPolicy(address account, uint8 op, address book, uint256 amount)
        external
        view
        returns (bool applies, bool fresh, uint256 ltv, bool cashOk);
}

/// @notice Read-only binding to an existing, factory-recognized V1 market. Settlement stays on the account.
contract PeridotLendingAdapter {
    IV2MarketFactory public immutable marketFactory;
    IV2IsolatedController public immutable controller;
    IV2MarketBook public immutable collateralMarket;
    IV2MarketBook public immutable debtMarket;
    address public immutable collateralAsset;
    address public immutable debtAsset;
    IV2LendingRegistry public immutable registry;
    IV2LendingPolicy public immutable policyAdapter;

    error UnknownMarket();
    error InvalidOperation();
    error AccountPolicyMissing();
    error UnsupportedChain(uint256 chainId);

    constructor(IV2MarketFactory marketFactory_, IV2IsolatedController controller_) {
        if (block.chainid != 1952 && block.chainid != 31337) revert UnsupportedChain(block.chainid);
        if (!marketFactory_.isMarket(address(controller_))) revert UnknownMarket();
        marketFactory = marketFactory_;
        controller = controller_;
        collateralMarket = controller_.collateralMarket();
        debtMarket = controller_.debtMarket();
        collateralAsset = controller_.collateralAsset();
        debtAsset = controller_.debtAsset();
        registry = controller_.registry();
        policyAdapter = controller_.adapter();
    }

    function requireAccountPolicy(bytes32 id) external view {
        registry.requirePolicy(id, 1);
    }

    /// @dev The account accrues both books immediately before this read. Uses the same preview as V1 market hooks.
    function checkAccountPolicy(bytes32 id, address account, uint8 op, uint256 amount)
        external
        view
        returns (bool applies, bool fresh, uint256 ltv, bool cashOk)
    {
        if (op > 2) revert InvalidOperation();
        address book = op == 2 ? address(debtMarket) : address(collateralMarket);
        (applies, fresh, ltv, cashOk) = controller.previewPolicy(account, op, book, amount);
        if (applies) {
            if (id == bytes32(0)) revert AccountPolicyMissing();
            policyAdapter.enforce(id, 1, op, fresh, ltv, cashOk);
        }
    }
}
