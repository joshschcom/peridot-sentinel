// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PeridotLendingAdapter, IV2IsolatedController, IV2MarketBook} from "./PeridotLendingAdapter.sol";

interface IV2SwapAdapter {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function maxAge() external view returns (uint256);
    function executionQuote(address tokenIn, uint256 amountIn)
        external
        view
        returns (uint256 expectedOut, uint256 floorOut, uint256 timestamp);
    function swapExactIn(address tokenIn, uint256 amountIn, uint256 minOut, uint64 deadline)
        external
        returns (uint256 amountOut);
}

interface IV2ExecutionPolicy {
    function enforceSwap(uint8 checks, uint16 slippageBps) external view;
}

contract SentinelAccountV2 {
    uint8 public constant SUPPLY = 0;
    uint8 public constant REDEEM = 1;
    uint8 public constant BORROW = 2;
    uint8 public constant REPAY = 3;
    uint8 public constant SWAP = 5;

    address public immutable owner;
    PeridotLendingAdapter public immutable lendingAdapter;
    IV2SwapAdapter public immutable swapAdapter;
    IV2ExecutionPolicy public immutable executionPolicy;
    bytes32 public immutable lendingAdapterHash;
    bytes32 public immutable swapAdapterHash;
    bytes32 public immutable executionPolicyHash;
    IV2IsolatedController public immutable controller;
    IV2MarketBook public immutable collateralMarket;
    IV2MarketBook public immutable debtMarket;
    address public immutable collateralAsset;
    address public immutable debtAsset;
    address public immutable token0;
    address public immutable token1;
    uint256 public immutable swapMaxAge;
    bytes32 public policyId;
    bool private executing;

    struct Grant {
        uint256 maxPerCall;
        uint256 remaining;
        uint64 expiry;
    }

    mapping(
        address operator => mapping(address adapter => mapping(uint8 op => mapping(address inputAsset => Grant)))
    ) public grants;

    error UnsupportedChain(uint256 chainId);
    error InvalidConfiguration();
    error OwnerOnly();
    error AdapterChanged();
    error InvalidAsset();
    error InvalidAmount();
    error InvalidGrant();
    error OperatorNotAuthorized();
    error OperatorExpired();
    error BudgetExceeded();
    error ReentrantOperation();
    error MarketOperationFailed(uint256 code);
    error TokenOperationFailed();
    error DeadlineExpired();
    error PriceUnavailable();
    error SlippageExceeded();
    error InsufficientInput();
    error UnexpectedSettlement();

    event AccountPolicySet(bytes32 indexed policyId);
    event GrantSet(
        address indexed operator,
        address indexed adapter,
        uint8 indexed op,
        address inputAsset,
        uint256 maxPerCall,
        uint256 cumulativeLimit,
        uint64 expiry
    );
    event GrantRevoked(address indexed operator, address indexed adapter, uint8 indexed op, address inputAsset);
    event PolicyAllowed(
        bytes32 indexed policyId,
        address indexed account,
        uint8 indexed op,
        uint256 postLtvBps,
        bool oracleFresh,
        bool cashOk
    );
    event SwapSettled(
        address indexed operator,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint16 slippageBps
    );
    event Withdrawn(address indexed asset, address indexed owner, uint256 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert OwnerOnly();
        _;
    }

    modifier locked() {
        if (executing) revert ReentrantOperation();
        executing = true;
        _;
        executing = false;
    }

    constructor(
        address owner_,
        PeridotLendingAdapter lending_,
        IV2SwapAdapter swap_,
        IV2ExecutionPolicy execution_,
        bytes32 initialPolicy
    ) {
        if (block.chainid != 1952 && block.chainid != 31337) {
            revert UnsupportedChain(block.chainid);
        }
        if (
            owner_ == address(0) || address(lending_).code.length == 0 || address(swap_).code.length == 0
                || address(execution_).code.length == 0
        ) revert InvalidConfiguration();
        owner = owner_;
        lendingAdapter = lending_;
        swapAdapter = swap_;
        executionPolicy = execution_;
        lendingAdapterHash = address(lending_).codehash;
        swapAdapterHash = address(swap_).codehash;
        executionPolicyHash = address(execution_).codehash;
        controller = lending_.controller();
        collateralMarket = lending_.collateralMarket();
        debtMarket = lending_.debtMarket();
        collateralAsset = lending_.collateralAsset();
        debtAsset = lending_.debtAsset();
        token0 = swap_.token0();
        token1 = swap_.token1();
        swapMaxAge = swap_.maxAge();
        if (
            token0 == token1 || token0.code.length == 0 || token1.code.length == 0 || swapMaxAge == 0
                || token0 == address(collateralMarket) || token0 == address(debtMarket)
                || token1 == address(collateralMarket) || token1 == address(debtMarket)
        ) revert InvalidConfiguration();
        lending_.requireAccountPolicy(initialPolicy);
        policyId = initialPolicy;
        emit AccountPolicySet(initialPolicy);
    }

    function setPolicy(bytes32 id) external onlyOwner {
        if (id != 0) {
            _checkPin(address(lendingAdapter), lendingAdapterHash);
            lendingAdapter.requireAccountPolicy(id);
        }
        policyId = id;
        emit AccountPolicySet(id);
    }

    function setGrant(
        address operator,
        address adapter,
        uint8 op,
        address inputAsset,
        uint256 maxPerCall,
        uint256 cumulativeLimit,
        uint64 expiry
    ) external onlyOwner {
        if (
            operator == address(0) || operator == owner || maxPerCall == 0 || maxPerCall > cumulativeLimit
                || expiry <= block.timestamp || !_supportedGrant(adapter, op, inputAsset)
        ) revert InvalidGrant();
        grants[operator][adapter][op][inputAsset] = Grant(maxPerCall, cumulativeLimit, expiry);
        emit GrantSet(operator, adapter, op, inputAsset, maxPerCall, cumulativeLimit, expiry);
    }

    function revokeGrant(address operator, address adapter, uint8 op, address inputAsset) external onlyOwner {
        delete grants[operator][adapter][op][inputAsset];
        emit GrantRevoked(operator, adapter, op, inputAsset);
    }

    function _supportedGrant(address adapter, uint8 op, address asset) private view returns (bool) {
        if (adapter == address(swapAdapter)) return op == SWAP && (asset == token0 || asset == token1);
        if (adapter != address(lendingAdapter)) return false;
        if (op == SUPPLY) return asset == collateralAsset;
        if (op == REDEEM) return asset == address(collateralMarket);
        return (op == BORROW || op == REPAY) && asset == debtAsset;
    }

    function _charge(address adapter, uint8 op, address asset, uint256 amount) private {
        if (amount == 0) revert InvalidAmount();
        if (msg.sender == owner) return;
        Grant storage grant = grants[msg.sender][adapter][op][asset];
        if (grant.expiry == 0) revert OperatorNotAuthorized();
        if (block.timestamp >= grant.expiry) revert OperatorExpired();
        if (amount > grant.maxPerCall || amount > grant.remaining) revert BudgetExceeded();
        grant.remaining -= amount;
    }

    function _checkPin(address target, bytes32 expected) private view {
        if (target.codehash != expected) revert AdapterChanged();
    }

    function _checkLendingPolicy(uint8 op, uint256 amount) private {
        _checkPin(address(lendingAdapter), lendingAdapterHash);
        controller.accrue();
        (bool applies, bool fresh, uint256 ltv, bool cashOk) =
            lendingAdapter.checkAccountPolicy(policyId, address(this), op, amount);
        if (applies) emit PolicyAllowed(policyId, address(this), op, ltv, fresh, cashOk);
    }

    function _marketResult(uint256 code) private pure {
        if (code != 0) revert MarketOperationFailed(code);
    }

    function _approve(address asset, address spender, uint256 amount) private {
        if (!IERC20(asset).approve(spender, amount) || IERC20(asset).allowance(address(this), spender) != amount) {
            revert TokenOperationFailed();
        }
    }

    /// @notice Raw share balance and stored underlying debt at the books' latest accrual.
    function exposure() external view returns (uint256 collateralShares, uint256 debtRaw) {
        return (collateralMarket.balanceOf(address(this)), debtMarket.borrowBalanceStored(address(this)));
    }

    function enterCollateral() external onlyOwner locked {
        address[] memory markets = new address[](1);
        markets[0] = address(collateralMarket);
        _marketResult(controller.enterMarkets(markets)[0]);
    }

    function supply(uint256 amount) external locked {
        _charge(address(lendingAdapter), SUPPLY, collateralAsset, amount);
        _checkLendingPolicy(SUPPLY, amount);
        uint256 idleBefore = IERC20(collateralAsset).balanceOf(address(this));
        uint256 sharesBefore = collateralMarket.balanceOf(address(this));
        uint256 expectedShares = Math.mulDiv(amount, 1e18, collateralMarket.exchangeRateStored());
        _approve(collateralAsset, address(collateralMarket), amount);
        _marketResult(collateralMarket.mint(amount));
        _approve(collateralAsset, address(collateralMarket), 0);
        if (
            IERC20(collateralAsset).balanceOf(address(this)) != idleBefore - amount
                || collateralMarket.balanceOf(address(this)) != sharesBefore + expectedShares
        ) revert UnexpectedSettlement();
    }

    function redeem(uint256 shares) external locked {
        _charge(address(lendingAdapter), REDEEM, address(collateralMarket), shares);
        if (controller.collateralEntered(address(this)) && debtMarket.borrowBalanceStored(address(this)) != 0) {
            _checkLendingPolicy(REDEEM, shares);
        }
        uint256 idleBefore = IERC20(collateralAsset).balanceOf(address(this));
        uint256 sharesBefore = collateralMarket.balanceOf(address(this));
        uint256 expectedOut = Math.mulDiv(shares, collateralMarket.exchangeRateCurrent(), 1e18);
        _marketResult(collateralMarket.redeem(shares));
        if (
            IERC20(collateralAsset).balanceOf(address(this)) != idleBefore + expectedOut
                || collateralMarket.balanceOf(address(this)) != sharesBefore - shares
        ) revert UnexpectedSettlement();
    }

    function borrow(uint256 amount) external locked {
        _charge(address(lendingAdapter), BORROW, debtAsset, amount);
        _checkLendingPolicy(BORROW, amount);
        uint256 idleBefore = IERC20(debtAsset).balanceOf(address(this));
        uint256 debtBefore = debtMarket.borrowBalanceStored(address(this));
        _marketResult(debtMarket.borrow(amount));
        if (
            IERC20(debtAsset).balanceOf(address(this)) != idleBefore + amount
                || debtMarket.borrowBalanceStored(address(this)) != debtBefore + amount
        ) revert UnexpectedSettlement();
    }

    /// @notice Charge only the debt actually settled. Repayment has no oracle or processor dependency.
    function repay(uint256 maxAmount) external locked returns (uint256 amount) {
        uint256 debtBefore = debtMarket.borrowBalanceCurrent(address(this));
        uint256 idleBefore = IERC20(debtAsset).balanceOf(address(this));
        amount = Math.min(maxAmount, Math.min(debtBefore, idleBefore));
        _charge(address(lendingAdapter), REPAY, debtAsset, amount);
        _approve(debtAsset, address(debtMarket), amount);
        _marketResult(debtMarket.repayBorrow(amount));
        _approve(debtAsset, address(debtMarket), 0);
        if (
            IERC20(debtAsset).balanceOf(address(this)) != idleBefore - amount
                || debtMarket.borrowBalanceStored(address(this)) != debtBefore - amount
        ) revert UnexpectedSettlement();
    }

    function swapExactIn(address tokenIn, uint256 amountIn, uint256 minOut, uint64 deadline)
        external
        locked
        returns (uint256 amountOut)
    {
        _checkPin(address(swapAdapter), swapAdapterHash);
        _checkPin(address(executionPolicy), executionPolicyHash);
        if (tokenIn != token0 && tokenIn != token1) revert InvalidAsset();
        if (block.timestamp > deadline) revert DeadlineExpired();
        _charge(address(swapAdapter), SWAP, tokenIn, amountIn);
        address tokenOut = tokenIn == token0 ? token1 : token0;
        uint256 beforeIn = IERC20(tokenIn).balanceOf(address(this));
        if (amountIn > beforeIn) revert InsufficientInput();
        (uint256 expected, uint256 floor, uint256 timestamp) = swapAdapter.executionQuote(tokenIn, amountIn);
        if (expected == 0 || timestamp == 0 || timestamp > block.timestamp || block.timestamp - timestamp > swapMaxAge)
        {
            revert PriceUnavailable();
        }
        uint256 loss = minOut < expected ? Math.mulDiv(expected - minOut, 10_000, expected, Math.Rounding.Ceil) : 0;
        if (minOut == 0 || minOut < floor || loss > 500) revert SlippageExceeded();
        // Verified pair and pinned targets, authorized spend, fresh quote, available input.
        executionPolicy.enforceSwap(0x0f, uint16(loss));
        uint256 beforeOut = IERC20(tokenOut).balanceOf(address(this));
        _approve(tokenIn, address(swapAdapter), amountIn);
        amountOut = swapAdapter.swapExactIn(tokenIn, amountIn, minOut, deadline);
        _approve(tokenIn, address(swapAdapter), 0);
        uint256 afterOut = IERC20(tokenOut).balanceOf(address(this));
        if (
            IERC20(tokenIn).balanceOf(address(this)) != beforeIn - amountIn || afterOut < beforeOut
                || afterOut - beforeOut != amountOut || amountOut < minOut
        ) revert UnexpectedSettlement();
        emit SwapSettled(msg.sender, tokenIn, tokenOut, amountIn, amountOut, uint16(loss));
    }

    function withdraw(address asset, uint256 amount) external onlyOwner locked {
        if (asset != collateralAsset && asset != debtAsset && asset != token0 && asset != token1) {
            revert InvalidAsset();
        }
        if (amount == 0) revert InvalidAmount();
        if (!IERC20(asset).transfer(owner, amount)) revert TokenOperationFailed();
        emit Withdrawn(asset, owner, amount);
    }
}
