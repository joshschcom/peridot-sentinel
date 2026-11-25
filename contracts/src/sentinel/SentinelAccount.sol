// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IsolatedController} from "../markets/IsolatedController.sol";
import {MarketPToken} from "../markets/MarketPToken.sol";
import {TestProfile} from "../markets/TestProfile.sol";

/// @notice This account holds its own pTokens, debt and idle underlying. Fund it by ERC20 transfer.
contract SentinelAccount is TestProfile {
    uint8 private constant SUPPLY = 0;
    uint8 private constant REDEEM = 1;
    uint8 private constant BORROW = 2;
    uint8 private constant REPAY = 3;
    uint8 private constant ACCOUNT_POLICY = 1;
    uint16 private constant OPERATOR_MASK = (uint16(1) << BORROW) | (uint16(1) << REPAY);

    address public immutable owner;
    IsolatedController public immutable controller;
    MarketPToken public immutable collateralMarket;
    MarketPToken public immutable debtMarket;
    IERC20 public immutable collateralAsset;
    IERC20 public immutable debtAsset;
    bytes32 public policyId;
    uint16 public autoRepayTriggerBps;

    struct Grant {
        uint16 opsMask;
        uint256 remaining;
        uint64 expiry;
    }

    mapping(address operator => Grant) public operators;

    error OwnerOnly();
    error OperatorNotAuthorized(address operator, uint8 op);
    error OperatorExpired();
    error ExceedsOperatorLimit();
    error InvalidGrant();
    error InvalidAmount();
    error InvalidAsset();
    error TokenOperationFailed();
    error MarketOperationFailed(uint256 code);
    error TriggerNotMet();
    error InvalidTrigger();
    error AccountPolicyMissing();

    event AccountPolicySet(bytes32 indexed policyId);
    event OperatorSet(address indexed operator, uint16 opsMask, uint256 maxAmount, uint64 expiry);
    event OperatorRevoked(address indexed operator);
    event AutoRepayTriggerSet(uint16 triggerBps);
    event AutoRepayExecuted(address indexed operator, uint256 amount, uint256 ltvBeforeBps, uint256 ltvAfterBps);
    event Withdrawn(address indexed asset, address indexed owner, uint256 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert OwnerOnly();
        _;
    }

    constructor(address owner_, IsolatedController controller_, bytes32 initialPolicy) {
        if (owner_ == address(0)) revert OwnerOnly();
        owner = owner_;
        controller = controller_;
        collateralMarket = controller_.collateralMarket();
        debtMarket = controller_.debtMarket();
        collateralAsset = IERC20(controller_.collateralAsset());
        debtAsset = IERC20(controller_.debtAsset());
        controller_.registry().requirePolicy(initialPolicy, ACCOUNT_POLICY);
        policyId = initialPolicy;
        emit AccountPolicySet(initialPolicy);
    }

    /// @notice Setting zero revokes the policy and pauses account risk increases.
    function setPolicy(bytes32 id) external onlyOwner {
        if (id != 0) controller.registry().requirePolicy(id, ACCOUNT_POLICY);
        policyId = id;
        emit AccountPolicySet(id);
    }

    /// @notice Zero disables automation. Other values are inclusive trigger LTVs in basis points.
    function setAutoRepayTrigger(uint16 bps) external onlyOwner {
        if (bps > 10_000) revert InvalidTrigger();
        autoRepayTriggerBps = bps;
        emit AutoRepayTriggerSet(bps);
    }

    /// @notice A new grant replaces the previous one. The cumulative budget is in raw debt-asset units.
    function setOperator(address operator, uint16 opsMask, uint256 maxAmount, uint64 expiry) external onlyOwner {
        if (
            operator == address(0) || operator == owner || opsMask == 0 || (opsMask & ~OPERATOR_MASK) != 0
                || maxAmount == 0 || expiry <= block.timestamp
        ) revert InvalidGrant();
        operators[operator] = Grant(opsMask, maxAmount, expiry);
        emit OperatorSet(operator, opsMask, maxAmount, expiry);
    }

    function revokeOperator(address operator) external onlyOwner {
        delete operators[operator];
        emit OperatorRevoked(operator);
    }

    function _authorizedGrant(uint8 op) private view returns (Grant storage grant) {
        grant = operators[msg.sender];
        if ((grant.opsMask & (uint16(1) << op)) == 0) revert OperatorNotAuthorized(msg.sender, op);
        if (block.timestamp >= grant.expiry) revert OperatorExpired();
    }

    function _checkAccountPolicy(uint8 op, MarketPToken book, uint256 amount) private {
        if (amount == 0) revert InvalidAmount();
        controller.accrue();
        (bool applies, bool fresh, uint256 ltv, bool cashOk) =
            controller.previewPolicy(address(this), op, address(book), amount);
        if (applies) {
            if (policyId == 0) revert AccountPolicyMissing();
            controller.adapter().enforce(policyId, ACCOUNT_POLICY, op, fresh, ltv, cashOk);
        }
    }

    function _checkResult(uint256 code) private pure {
        if (code != 0) revert MarketOperationFailed(code);
    }

    function supply(uint256 amount) external onlyOwner {
        _checkAccountPolicy(SUPPLY, collateralMarket, amount);
        if (!collateralAsset.approve(address(collateralMarket), amount)) revert TokenOperationFailed();
        _checkResult(collateralMarket.mint(amount));
        if (!collateralAsset.approve(address(collateralMarket), 0)) revert TokenOperationFailed();
    }

    function enterCollateral() external onlyOwner {
        address[] memory markets = new address[](1);
        markets[0] = address(collateralMarket);
        _checkResult(controller.enterMarkets(markets)[0]);
    }

    /// @param shares Amount of collateral pTokens, in raw share units.
    function redeem(uint256 shares) external onlyOwner {
        _checkAccountPolicy(REDEEM, collateralMarket, shares);
        _checkResult(collateralMarket.redeem(shares));
    }

    function borrow(uint256 amount) external {
        if (msg.sender != owner) {
            Grant storage grant = _authorizedGrant(BORROW);
            if (amount > grant.remaining) revert ExceedsOperatorLimit();
            grant.remaining -= amount;
        }
        _checkAccountPolicy(BORROW, debtMarket, amount);
        _checkResult(debtMarket.borrow(amount));
    }

    /// @notice Owner repayment has no trigger, oracle or processor dependency.
    function repay(uint256 maxAmount) external onlyOwner returns (uint256 amount) {
        uint256 debt = debtMarket.borrowBalanceCurrent(address(this));
        amount = _repayable(debt, maxAmount);
        _repay(amount);
    }

    function _repayable(uint256 debt, uint256 budget) private view returns (uint256 amount) {
        amount = Math.min(Math.min(debt, debtAsset.balanceOf(address(this))), budget);
        if (amount == 0) revert InvalidAmount();
    }

    function _repay(uint256 amount) private {
        if (!debtAsset.approve(address(debtMarket), amount)) revert TokenOperationFailed();
        _checkResult(debtMarket.repayBorrow(amount));
        if (!debtAsset.approve(address(debtMarket), 0)) revert TokenOperationFailed();
    }

    /// @notice On each execution, read fresh authoritative LTV and use the smaller of funds, debt and grant balance.
    function autoRepay() external returns (uint256 amount) {
        Grant storage grant = _authorizedGrant(REPAY);
        if (grant.remaining == 0) revert ExceedsOperatorLimit();
        if (autoRepayTriggerBps == 0) revert TriggerNotMet();
        controller.accrue();
        uint256 beforeLtv = controller.currentLtvBps(address(this));
        if (beforeLtv < autoRepayTriggerBps) revert TriggerNotMet();
        amount = _repayable(debtMarket.borrowBalanceStored(address(this)), grant.remaining);
        grant.remaining -= amount;
        _repay(amount);
        emit AutoRepayExecuted(msg.sender, amount, beforeLtv, controller.currentLtvBps(address(this)));
    }

    /// @notice Withdraw idle underlying to the immutable owner. pTokens remain on the account.
    function withdraw(address asset, uint256 amount) external onlyOwner {
        if (asset != address(collateralAsset) && asset != address(debtAsset)) revert InvalidAsset();
        if (amount == 0) revert InvalidAmount();
        if (!IERC20(asset).transfer(owner, amount)) revert TokenOperationFailed();
        emit Withdrawn(asset, owner, amount);
    }
}
