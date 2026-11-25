// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PToken, PeridottrollerInterface, EIP20Interface} from "../core/PToken.sol";
import {MarketPToken} from "./MarketPToken.sol";
import {IPolicyActivity} from "./IPolicyActivity.sol";
import {TestProfile} from "./TestProfile.sol";

interface IMarketRegistry {
    function requirePolicy(bytes32 id, uint8 kind) external view;
}

interface IMarketAdapter {
    function enforce(bytes32 id, uint8 kind, uint8 op, bool fresh, uint256 postLtvBps, bool cashOk) external view;
}

interface IMarketOracle {
    function price(address asset) external view returns (uint256 usdWad, bool fresh);
}

/// @notice Isolated two-book implementation of the imported Peridottroller interface.
/// A single collateral asset backs a single debt asset. Membership is explicit.
contract IsolatedController is PeridottrollerInterface, TestProfile, IPolicyActivity {
    uint8 private constant SUPPLY = 0;
    uint8 private constant REDEEM = 1;
    uint8 private constant BORROW = 2;
    uint8 private constant EXIT = 5;
    uint8 private constant TRANSFER = 9;

    struct Limits {
        uint16 borrowLtvBps;
        uint16 liquidationLtvBps;
        uint128 collateralSupplyCap;
        uint128 debtSupplyCap;
        uint128 borrowCap;
        uint128 minCash;
    }

    address public immutable owner;
    MarketPToken public immutable collateralMarket;
    MarketPToken public immutable debtMarket;
    address public immutable collateralAsset;
    address public immutable debtAsset;
    uint256 private immutable collateralUnit;
    uint256 private immutable debtUnit;
    IMarketRegistry public immutable registry;
    IMarketAdapter public immutable adapter;
    IMarketOracle public immutable oracle;
    Limits public limits;
    bytes32 public policyId;
    bool public active;
    mapping(address => bool) public collateralEntered;

    event MarketPolicySet(address indexed controller, bytes32 indexed policyId);
    event MarketActivated(address indexed controller);
    event MarketEntered(address indexed pToken, address indexed account);
    event MarketExited(address indexed pToken, address indexed account);
    error Unauthorized();
    error InvalidMarket();
    error InvalidLimits();
    error Inactive();
    error InvalidOracle();
    error InsufficientLiquidity();
    error SupplyCapExceeded();
    error BorrowCapExceeded();
    error InvalidOperation();
    error LiquidationUnavailable();

    constructor(
        address owner_,
        address collateral_,
        address debt_,
        address collateralBook_,
        address debtBook_,
        address registry_,
        address adapter_,
        address oracle_,
        bytes32 policy_,
        Limits memory limits_
    ) {
        if (
            limits_.borrowLtvBps == 0 || limits_.borrowLtvBps > 8000
                || limits_.liquidationLtvBps <= limits_.borrowLtvBps || limits_.liquidationLtvBps > 9000
                || limits_.collateralSupplyCap == 0 || limits_.borrowCap == 0
                || limits_.minCash >= limits_.debtSupplyCap
                || limits_.borrowCap > limits_.debtSupplyCap - limits_.minCash
        ) {
            revert InvalidLimits();
        }
        owner = owner_;
        collateralMarket = MarketPToken(collateralBook_);
        debtMarket = MarketPToken(debtBook_);
        collateralAsset = collateral_;
        debtAsset = debt_;
        collateralUnit = 10 ** uint256(EIP20Interface(collateral_).decimals());
        debtUnit = 10 ** uint256(EIP20Interface(debt_).decimals());
        registry = IMarketRegistry(registry_);
        adapter = IMarketAdapter(adapter_);
        oracle = IMarketOracle(oracle_);
        limits = limits_;
        _setPolicy(policy_);
    }

    function activate() external {
        if (msg.sender != owner) revert Unauthorized();
        if (active) revert InvalidOperation();
        (,, bool fresh) = _prices();
        if (!fresh) revert InvalidOracle();
        if (debtMarket.totalSupply() == 0 || debtMarket.getCash() <= limits.minCash) revert InsufficientLiquidity();
        registry.requirePolicy(policyId, 0);
        active = true;
        emit MarketActivated(address(this));
    }

    function setPolicy(bytes32 value) external {
        if (msg.sender != owner) revert Unauthorized();
        _setPolicy(value);
    }

    function _setPolicy(bytes32 value) private {
        registry.requirePolicy(value, 0);
        policyId = value;
        emit MarketPolicySet(address(this), value);
    }

    function accrue() public {
        // Baseline accrueInterest is idempotent within a block, including inside the pToken hooks.
        collateralMarket.accrueInterest();
        debtMarket.accrueInterest();
    }

    function enterMarkets(address[] calldata markets) external override returns (uint256[] memory codes) {
        codes = new uint256[](markets.length);
        for (uint256 i; i < markets.length; ++i) {
            if (markets[i] != address(collateralMarket)) revert InvalidMarket();
            if (!collateralEntered[msg.sender]) {
                collateralEntered[msg.sender] = true;
                emit MarketEntered(markets[i], msg.sender);
            }
        }
    }

    function exitMarket(address market) external override returns (uint256) {
        if (market != address(collateralMarket)) revert InvalidMarket();
        if (!collateralEntered[msg.sender]) return 0;
        accrue();
        _check(msg.sender, EXIT, market, collateralMarket.balanceOf(msg.sender));
        collateralEntered[msg.sender] = false;
        emit MarketExited(market, msg.sender);
        return 0;
    }

    function getAllMarkets() external view override returns (PToken[] memory books) {
        books = new PToken[](2);
        books[0] = collateralMarket;
        books[1] = debtMarket;
    }

    function _book(address market) private view {
        if (market != address(collateralMarket) && market != address(debtMarket)) revert InvalidMarket();
    }

    function _caller(address market) private view {
        _book(market);
        if (msg.sender != market) revert Unauthorized();
    }

    function _prices() private view returns (uint256 colPrice, uint256 debtPrice, bool fresh) {
        (uint256 c, bool okC) = oracle.price(collateralAsset);
        (uint256 d, bool okD) = oracle.price(debtAsset);
        return (c, d, okC && okD && c != 0 && d != 0);
    }

    function _values(uint256 shares, uint256 debt) private view returns (uint256 c, uint256 d, bool fresh) {
        (uint256 colPrice, uint256 debtPrice, bool ok) = _prices();
        uint256 underlying = Math.mulDiv(shares, collateralMarket.exchangeRateStored(), 1e18);
        return (
            Math.mulDiv(underlying, colPrice, collateralUnit),
            Math.mulDiv(debt, debtPrice, debtUnit, Math.Rounding.Ceil),
            ok
        );
    }

    function _ratio(uint256 c, uint256 d) private pure returns (uint256) {
        return d == 0 ? 0 : c == 0 ? type(uint256).max : Math.mulDiv(d, 10_000, c, Math.Rounding.Ceil);
    }

    function _shares(address account) private view returns (uint256) {
        return collateralEntered[account] ? collateralMarket.balanceOf(account) : 0;
    }

    /// @notice Stored position. Call accrue first within a settlement transaction.
    function currentLtvBps(address account) external view returns (uint256) {
        (uint256 c, uint256 d, bool fresh) = _values(_shares(account), debtMarket.borrowBalanceStored(account));
        if (!fresh) revert InvalidOracle();
        return _ratio(c, d);
    }

    function getAccountLiquidity(address account) external view override returns (uint256, uint256, uint256) {
        (uint256 c, uint256 d, bool fresh) = _values(_shares(account), debtMarket.borrowBalanceStored(account));
        if (!fresh) revert InvalidOracle();
        uint256 capacity = Math.mulDiv(c, limits.borrowLtvBps, 10_000);
        return capacity >= d ? (uint256(0), capacity - d, uint256(0)) : (uint256(0), uint256(0), d - capacity);
    }

    /// @notice Supply/borrow use raw underlying units. Redeem/transfer/exit use pToken shares.
    function previewPolicy(address account, uint8 op, address market, uint256 amount)
        public
        view
        returns (bool applies, bool oracleFresh, uint256 postLtvBps, bool cashOk)
    {
        _book(market);
        uint256 debt = debtMarket.borrowBalanceStored(account);
        uint256 shares = _shares(account);
        bool pledged = market == address(collateralMarket) && collateralEntered[account];
        cashOk = true;
        if (op == SUPPLY) {
            applies = true;
            if (pledged) shares += Math.mulDiv(amount, 1e18, collateralMarket.exchangeRateStored());
        } else if (op == BORROW) {
            if (market != address(debtMarket)) revert InvalidMarket();
            applies = true;
            debt += amount;
            uint256 cash = debtMarket.getCash();
            cashOk = amount <= cash && cash - amount >= limits.minCash;
        } else if (op == REDEEM || op == TRANSFER || op == EXIT) {
            applies = pledged && debt > 0 && amount > 0;
            if (pledged) shares -= amount;
        } else {
            revert InvalidOperation();
        }
        // An ungated exit does not need a working price feed or circuit.
        if (!applies) return (false, false, 0, true);
        (uint256 c, uint256 d, bool fresh) = _values(shares, debt);
        return (true, fresh, _ratio(c, d), cashOk);
    }

    function _check(address account, uint8 op, address market, uint256 amount) private {
        (bool applies, bool fresh, uint256 postLtv, bool cashOk) = previewPolicy(account, op, market, amount);
        if (!applies) return;
        if (!fresh) revert InvalidOracle();
        if (op != SUPPLY && (!cashOk || postLtv > limits.borrowLtvBps)) revert InsufficientLiquidity();
        adapter.enforce(policyId, 0, op, fresh, postLtv, cashOk);
        emit PolicyAllowed(policyId, account, op, postLtv, fresh, cashOk);
    }

    function mintAllowed(address market, address account, uint256 amount) external override returns (uint256) {
        _caller(market);
        accrue();
        MarketPToken book = MarketPToken(market);
        uint256 assets = book.getCash() + book.totalBorrows() - book.totalReserves();
        uint256 cap = market == address(collateralMarket) ? limits.collateralSupplyCap : limits.debtSupplyCap;
        if (assets + amount > cap) revert SupplyCapExceeded();
        _check(account, SUPPLY, market, amount);
        return 0;
    }

    function redeemAllowed(address market, address account, uint256 shares) external override returns (uint256) {
        _caller(market);
        accrue();
        _check(account, REDEEM, market, shares);
        return 0;
    }

    function transferAllowed(address market, address src, address, uint256 shares) external override returns (uint256) {
        _caller(market);
        accrue();
        _check(src, TRANSFER, market, shares);
        return 0;
    }

    function borrowAllowed(address market, address account, uint256 amount) external override returns (uint256) {
        _caller(market);
        if (market != address(debtMarket)) revert InvalidMarket();
        if (!active) revert Inactive();
        accrue();
        if (debtMarket.totalBorrows() + amount > limits.borrowCap) revert BorrowCapExceeded();
        _check(account, BORROW, market, amount);
        return 0;
    }

    function repayBorrowAllowed(address market, address, address, uint256) external view override returns (uint256) {
        _caller(market);
        return 0;
    }

    function liquidateBorrowAllowed(address borrowed, address collateral, address, address borrower, uint256 amount)
        external
        view
        override
        returns (uint256)
    {
        _caller(borrowed);
        if (borrowed != address(debtMarket) || collateral != address(collateralMarket)) revert InvalidMarket();
        uint256 debt = debtMarket.borrowBalanceStored(borrower);
        (uint256 c, uint256 d, bool fresh) = _values(_shares(borrower), debt);
        if (!fresh) revert InvalidOracle();
        // Allow half the outstanding balance per liquidation, rounding up for a final base unit.
        if (d <= Math.mulDiv(c, limits.liquidationLtvBps, 10_000) || amount > Math.ceilDiv(debt, 2)) {
            revert LiquidationUnavailable();
        }
        return 0;
    }

    function seizeAllowed(address collateral, address borrowed, address, address, uint256)
        external
        view
        override
        returns (uint256)
    {
        if (msg.sender != address(collateralMarket) || collateral != msg.sender || borrowed != address(debtMarket)) revert InvalidMarket();
        return 0;
    }

    function liquidateCalculateSeizeTokens(address borrowed, address collateral, uint256 repaid)
        external
        view
        override
        returns (uint256, uint256)
    {
        if (borrowed != address(debtMarket) || collateral != address(collateralMarket)) revert InvalidMarket();
        (uint256 colPrice, uint256 debtPrice, bool fresh) = _prices();
        if (!fresh) revert InvalidOracle();
        uint256 value = Math.mulDiv(repaid, debtPrice, debtUnit);
        uint256 colUnderlying = Math.mulDiv(Math.mulDiv(value, 10_500, 10_000), collateralUnit, colPrice);
        return (0, Math.mulDiv(colUnderlying, 1e18, collateralMarket.exchangeRateStored()));
    }

    // Legacy post-operation hooks have no mutable state. Solvency is enforced before settlement.
    function mintVerify(address, address, uint256, uint256) external pure override {}
    function redeemVerify(address, address, uint256, uint256) external pure override {}
    function borrowVerify(address, address, uint256) external pure override {}
    function repayBorrowVerify(address, address, address, uint256, uint256) external pure override {}
    function transferVerify(address, address, address, uint256) external pure override {}
    function seizeVerify(address, address, address, address, uint256) external pure override {}
    function liquidateBorrowVerify(address, address, address, address, uint256, uint256) external pure override {}
}
