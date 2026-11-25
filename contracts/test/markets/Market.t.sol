// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MarketFactory} from "../../src/markets/MarketFactory.sol";
import {IsolatedController} from "../../src/markets/IsolatedController.sol";
import {MarketPToken} from "../../src/markets/MarketPToken.sol";
import {TestProfile} from "../../src/markets/TestProfile.sol";
import {TestnetToken} from "../../src/mocks/TestnetToken.sol";
import {TestnetOracle} from "../../src/mocks/TestnetOracle.sol";
import {JumpRateModel} from "../../src/core/JumpRateModel.sol";

interface VmMarket {
    function startPrank(address) external;
    function stopPrank() external;
    function prank(address) external;
    function expectRevert(bytes4) external;
    function expectRevert(bytes calldata) external;
    function warp(uint256) external;
    function roll(uint256) external;
    function chainId(uint256) external;
    function getCode(string calldata artifact) external returns (bytes memory);
}

/// @notice Local test doubles exercise the controller's policy boundary independently of TapeOut.
contract MarketPolicyFixture {
    error MarketPolicyRejected(bytes32 id, uint8 reason);
    error FixtureOffline();
    bool public offline;
    uint256 public maxLtv = 5_000;
    uint8 public deniedOp = type(uint8).max;

    function configure(bool offline_, uint8 deniedOp_, uint256 maxLtv_) external {
        offline = offline_;
        deniedOp = deniedOp_;
        maxLtv = maxLtv_;
    }

    function requirePolicy(bytes32 id, uint8 kind) external pure {
        require(kind == 0 && id != 0);
    }

    function enforce(bytes32 id, uint8, uint8 op, bool fresh, uint256 postLtv, bool cashOk) external view {
        if (offline) revert FixtureOffline();
        if (op == deniedOp || !fresh || !cashOk || postLtv > maxLtv) revert MarketPolicyRejected(id, 0);
    }
}

contract MarketTest {
    VmMarket private constant vm = VmMarket(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant USER = address(0xa11ce);
    address private constant LIQUIDATOR = address(0xb0b);
    bytes32 private constant POLICY = bytes32(uint256(1));
    TestnetToken internal col;
    TestnetToken internal debt;
    TestnetOracle internal oracle;
    MarketPolicyFixture internal policy;
    MarketFactory internal factory;
    IsolatedController internal controller;
    MarketPToken internal pc;
    MarketPToken internal pd;

    function deployArtifact(string memory artifact, bytes memory args) private returns (address deployed) {
        bytes memory init = bytes.concat(vm.getCode(artifact), args);
        assembly ("memory-safe") { deployed := create(0, add(init, 32), mload(init)) }
        require(deployed != address(0), "artifact deployment failed");
    }

    function setUp() external {
        col = new TestnetToken("Mock collateral", "mCOL", 18);
        debt = new TestnetToken("Mock debt", "mUSD", 6);
        oracle = new TestnetOracle();
        oracle.setPrice(address(col), 2e18);
        oracle.setPrice(address(debt), 1e18);
        policy = new MarketPolicyFixture();
        address model = address(new JumpRateModel(0.02e18, 0.05e18, 0.2e18, 0.8e18));
        address book = deployArtifact("MarketPToken.sol:MarketPToken", "");
        factory = MarketFactory(
            deployArtifact(
                "MarketFactory.sol:MarketFactory",
                abi.encode(address(policy), address(policy), address(oracle), model, book, address(col), address(debt))
            )
        );
        controller = _create();
        pc = controller.collateralMarket();
        pd = controller.debtMarket();
        _fundBooks();
    }

    function _create() private returns (IsolatedController) {
        return IsolatedController(factory.createMarket(POLICY, 7500, 8500, 500e18, 1000e6, 900e6, 10e6));
    }

    function _fundBooks() private {
        debt.mint(address(this), 200e6);
        debt.approve(address(pd), 200e6);
        require(pd.mint(200e6) == 0);
        col.mint(USER, 100e18);
        vm.startPrank(USER);
        col.approve(address(pc), 100e18);
        require(pc.mint(100e18) == 0);
        address[] memory joined = new address[](1);
        joined[0] = address(pc);
        controller.enterMarkets(joined);
        vm.stopPrank();
    }

    function testLifecycleAccrualAndIsolation() external {
        vm.startPrank(USER);
        vm.expectRevert(IsolatedController.Inactive.selector);
        pd.borrow(60e6);
        vm.stopPrank();
        controller.activate();
        vm.prank(USER);
        pd.borrow(60e6);
        require(controller.currentLtvBps(USER) == 3000);
        vm.roll(block.number + 100_000);
        controller.accrue();
        require(pd.borrowBalanceStored(USER) > 60e6 && controller.currentLtvBps(USER) > 3000);
        IsolatedController other = _create();
        require(factory.marketCount() == 2 && factory.isMarket(address(other)));
        require(other.debtMarket().getCash() == 0 && other.debtMarket().borrowBalanceStored(USER) == 0);
        require(other.collateralMarket().balanceOf(USER) == 0 && !other.collateralEntered(USER));
    }

    function testDirectPolicyAtEveryRiskEntry() external {
        controller.activate();
        vm.startPrank(USER);
        vm.expectRevert(abi.encodeWithSelector(MarketPolicyFixture.MarketPolicyRejected.selector, POLICY, 0));
        pd.borrow(100e6 + 1); // LTV rounds up to 5001.
        pd.borrow(100e6); // Equality is allowed.
        vm.expectRevert(abi.encodeWithSelector(MarketPolicyFixture.MarketPolicyRejected.selector, POLICY, 0));
        pc.redeem(1e18);
        vm.expectRevert(abi.encodeWithSelector(MarketPolicyFixture.MarketPolicyRejected.selector, POLICY, 0));
        pc.transfer(LIQUIDATOR, 1e18);
        vm.expectRevert(abi.encodeWithSelector(MarketPolicyFixture.MarketPolicyRejected.selector, POLICY, 0));
        pc.redeemUnderlying(1e18);
        vm.expectRevert(IsolatedController.InsufficientLiquidity.selector);
        controller.exitMarket(address(pc));
        vm.stopPrank();
        policy.configure(false, 0, 10_000);
        vm.prank(USER);
        vm.expectRevert(abi.encodeWithSelector(MarketPolicyFixture.MarketPolicyRejected.selector, POLICY, 0));
        pc.mint(1);
    }

    function testRepayAndSafeExitWithFailedPolicyAndStaleOracle() external {
        controller.activate();
        vm.prank(USER);
        pd.borrow(50e6);
        policy.configure(true, 0, 0);
        vm.warp(block.timestamp + 2 days);
        vm.startPrank(USER);
        vm.expectRevert(IsolatedController.InvalidOracle.selector);
        pd.borrow(1);
        debt.approve(address(pd), 50e6);
        pd.repayBorrow(type(uint256).max);
        controller.exitMarket(address(pc));
        pc.redeem(100e18);
        vm.stopPrank();
        require(pd.borrowBalanceStored(USER) == 0 && col.balanceOf(USER) == 100e18);
    }

    function testLiquidationWhilePolicyOffline() external {
        controller.activate();
        vm.prank(USER);
        pd.borrow(90e6);
        oracle.setPrice(address(col), 1e18);
        policy.configure(true, 0, 0);
        debt.mint(LIQUIDATOR, 45e6);
        vm.startPrank(LIQUIDATOR);
        debt.approve(address(pd), 45e6);
        pd.liquidateBorrow(USER, 45e6, pc);
        vm.stopPrank();
        require(pd.borrowBalanceStored(USER) == 45e6 && pc.balanceOf(LIQUIDATOR) > 0);
        require(pc.balanceOf(USER) == 52.75e18);
    }

    function testCapsReserveAndOwnerAuthorization() external {
        vm.startPrank(USER);
        vm.expectRevert(IsolatedController.Unauthorized.selector);
        controller.activate();
        vm.expectRevert(IsolatedController.Unauthorized.selector);
        controller.setPolicy(bytes32(uint256(2)));
        vm.stopPrank();
        controller.activate();
        vm.startPrank(USER);
        vm.expectRevert(IsolatedController.SupplyCapExceeded.selector);
        pc.mint(401e18);
        vm.expectRevert(IsolatedController.BorrowCapExceeded.selector);
        pd.borrow(901e6);
        vm.stopPrank();
        // The debt supplier can redeem cash below the borrow reserve while holding no debt.
        pd.redeemUnderlying(195e6);
        require(pd.getCash() == 5e6);
        vm.prank(USER);
        vm.expectRevert(IsolatedController.InsufficientLiquidity.selector);
        pd.borrow(1e6);
    }

    function testReleaseNetworkRejectsTestProfile() external {
        vm.chainId(196);
        vm.expectRevert(abi.encodeWithSelector(TestProfile.UnsupportedChain.selector, uint256(196)));
        new TestnetOracle();
    }
}
