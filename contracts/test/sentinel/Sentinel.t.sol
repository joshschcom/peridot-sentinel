// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPolicyActivity} from "../../src/markets/IPolicyActivity.sol";
import {IsolatedController} from "../../src/markets/IsolatedController.sol";
import {MarketFactory} from "../../src/markets/MarketFactory.sol";
import {MarketPToken} from "../../src/markets/MarketPToken.sol";
import {TestnetToken} from "../../src/mocks/TestnetToken.sol";
import {TestnetOracle} from "../../src/mocks/TestnetOracle.sol";
import {JumpRateModel} from "../../src/core/JumpRateModel.sol";
import {PolicyRegistry} from "../../src/policies/PolicyRegistry.sol";
import {DevelopmentReferenceProcessor} from "../../src/policies/DevelopmentReferenceProcessor.sol";
import {TapeOutPolicyAdapter} from "../../src/policies/TapeOutPolicyAdapter.sol";
import {SentinelAccount} from "../../src/sentinel/SentinelAccount.sol";
import {SentinelAccountFactory} from "../../src/sentinel/SentinelAccountFactory.sol";
import {TightMarketFixture} from "./TightMarketFixture.sol";

interface VmSentinel {
    function getCode(string calldata artifact) external returns (bytes memory);
    function readFile(string calldata path) external view returns (string memory);
    function parseJsonBytes(string calldata json, string calldata key) external pure returns (bytes memory);
    function parseJsonBytes32(string calldata json, string calldata key) external pure returns (bytes32);
    function prank(address caller) external;
    function expectEmit(address emitter) external;
    function expectRevert(bytes4 reason) external;
    function expectRevert(bytes calldata reason) external;
    function warp(uint256 timestamp) external;
}

contract SentinelTest {
    VmSentinel constant vm = VmSentinel(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant OPERATOR = address(0xB0B);
    TestnetToken col;
    TestnetToken debt;
    TestnetOracle oracle;
    IsolatedController controller;
    PolicyRegistry registry;
    DevelopmentReferenceProcessor cpu;
    SentinelAccountFactory accounts;
    SentinelAccount account;
    MarketPToken collateralMarket;
    MarketPToken debtMarket;
    bytes32 marketPolicy;
    bytes32 accountPolicy;

    function _artifact(string memory artifact, bytes memory args) private returns (address deployed) {
        bytes memory init = bytes.concat(vm.getCode(artifact), args);
        assembly ("memory-safe") { deployed := create(0, add(init, 32), mload(init)) }
        require(deployed != address(0), "test setup deployment");
    }

    function _register(uint8 kind, bytes memory net, bytes32 config) private returns (bytes32) {
        uint256 id = cpu.addReferenceCircuit(net);
        return registry.register(address(cpu), id, kind, keccak256(net), config, bytes32(0));
    }

    function setUp() external {
        registry = new PolicyRegistry(address(this));
        cpu = new DevelopmentReferenceProcessor();
        registry.setProcessorTrust(address(cpu), true);
        string memory fixtures = vm.readFile("../packages/circuit-sdk/fixtures/policies-v1.json");
        marketPolicy = _register(
            0,
            vm.parseJsonBytes(fixtures, ".policies[0].netlist"),
            vm.parseJsonBytes32(fixtures, ".policies[0].configHash")
        );
        accountPolicy = _register(
            1,
            vm.parseJsonBytes(fixtures, ".policies[1].netlist"),
            vm.parseJsonBytes32(fixtures, ".policies[1].configHash")
        );

        col = new TestnetToken("Mock Collateral", "mCOL", 18);
        debt = new TestnetToken("Mock Debt", "mUSD", 6);
        oracle = new TestnetOracle();
        oracle.setPrice(address(col), 1e18);
        oracle.setPrice(address(debt), 1e18);
        address model = address(new JumpRateModel(0.02e18, 0.05e18, 0.2e18, 0.8e18));
        address pToken = _artifact("MarketPToken.sol:MarketPToken", "");
        MarketFactory markets = MarketFactory(
            _artifact(
                "MarketFactory.sol:MarketFactory",
                abi.encode(
                    address(registry),
                    address(new TapeOutPolicyAdapter(registry)),
                    address(oracle),
                    model,
                    pToken,
                    address(col),
                    address(debt)
                )
            )
        );
        controller = IsolatedController(markets.createMarket(marketPolicy, 7500, 8500, 500e18, 1000e6, 900e6, 10e6));
        collateralMarket = controller.collateralMarket();
        debtMarket = controller.debtMarket();
        debt.mint(address(this), 200e6);
        debt.approve(address(debtMarket), 200e6);
        require(debtMarket.mint(200e6) == 0);
        controller.activate();
        accounts =
            SentinelAccountFactory(_artifact("SentinelAccountFactory.sol:SentinelAccountFactory", abi.encode(markets)));
        account = SentinelAccount(accounts.createAccount(address(controller), accountPolicy));
        col.mint(address(account), 100e18);
        account.enterCollateral();
        account.supply(100e18);
    }

    function testSettledBorrowEmitsBothPolicyDecisions() external {
        vm.expectEmit(address(account));
        emit IPolicyActivity.PolicyAllowed(accountPolicy, address(account), 2, 5000, true, true);
        vm.expectEmit(address(controller));
        emit IPolicyActivity.PolicyAllowed(marketPolicy, address(account), 2, 5000, true, true);
        account.borrow(50e6);
        require(debtMarket.borrowBalanceStored(address(account)) == 50e6);
    }

    function testSeparatePoliciesAndBorrowerIdentity() external {
        account.borrow(50e6);
        // The SDK account policy accepts equality, and the market policy accepts up to 6500 bps.
        account.borrow(5e6);
        vm.expectRevert(
            abi.encodeWithSelector(TapeOutPolicyAdapter.AccountPolicyRejected.selector, accountPolicy, uint8(1))
        );
        account.borrow(1);
        account.repay(5e6);
        bytes32 tightMarket = _register(0, TightMarketFixture.PROGRAM, TightMarketFixture.CONFIG_HASH);
        controller.setPolicy(tightMarket);
        // The unchanged account permits 5001 bps; the market denies it.
        vm.expectRevert(
            abi.encodeWithSelector(TapeOutPolicyAdapter.MarketPolicyRejected.selector, tightMarket, uint8(1))
        );
        account.borrow(1);
        require(debtMarket.borrowBalanceStored(address(account)) == 50e6);
        require(debtMarket.borrowBalanceStored(address(this)) == 0 && debt.balanceOf(address(account)) == 50e6);
        require(
            collateralMarket.balanceOf(address(account)) == 100e18 && collateralMarket.balanceOf(address(this)) == 0
        );
    }

    function testBoundedKeeperRepayAndRevocation() external {
        account.borrow(45e6);
        account.withdraw(address(debt), 35e6); // Keep only 10 mUSD of the borrowed cash for repayment.
        account.setOperator(OPERATOR, 8, 15e6, uint64(block.timestamp + 1 days));
        account.setAutoRepayTrigger(5500);
        vm.prank(OPERATOR);
        vm.expectRevert(SentinelAccount.TriggerNotMet.selector);
        account.autoRepay();
        oracle.setPrice(address(col), 0.8e18);
        require(controller.currentLtvBps(address(account)) == 5625);
        registry.setProcessorTrust(address(cpu), false);
        vm.prank(OPERATOR);
        require(account.autoRepay() == 10e6);
        require(
            controller.currentLtvBps(address(account)) == 4375
                && debtMarket.borrowBalanceStored(address(account)) == 35e6
        );
        (, uint256 remaining,) = account.operators(OPERATOR);
        require(remaining == 5e6 && debt.allowance(address(account), address(debtMarket)) == 0);
        account.revokeOperator(OPERATOR);
        vm.prank(OPERATOR);
        vm.expectRevert(abi.encodeWithSelector(SentinelAccount.OperatorNotAuthorized.selector, OPERATOR, uint8(3)));
        account.autoRepay();
    }

    function testOwnerExitWithRevokedPolicyAndStalePrices() external {
        account.borrow(50e6);
        account.setPolicy(0);
        vm.expectRevert(SentinelAccount.AccountPolicyMissing.selector);
        account.borrow(1);
        registry.setProcessorTrust(address(cpu), false);
        vm.warp(block.timestamp + 2 days);
        require(account.repay(type(uint256).max) == 50e6);
        account.redeem(100e18);
        account.withdraw(address(col), 100e18);
        require(col.balanceOf(address(this)) == 100e18 && debtMarket.borrowBalanceStored(address(account)) == 0);
        require(
            col.allowance(address(account), address(collateralMarket)) == 0
                && debt.allowance(address(account), address(debtMarket)) == 0
        );
    }

    function testOperatorPermissionsBudgetAndExpiry() external {
        uint64 expiry = uint64(block.timestamp + 100);
        account.setOperator(OPERATOR, 4, 12e6, expiry);
        vm.prank(OPERATOR);
        account.borrow(7e6);
        vm.prank(OPERATOR);
        vm.expectRevert(SentinelAccount.ExceedsOperatorLimit.selector);
        account.borrow(6e6);
        vm.prank(OPERATOR);
        vm.expectRevert(SentinelAccount.OwnerOnly.selector);
        account.withdraw(address(debt), 7e6);
        vm.prank(OPERATOR);
        vm.expectRevert(SentinelAccount.OwnerOnly.selector);
        account.repay(1e6);
        vm.prank(OPERATOR);
        vm.expectRevert(abi.encodeWithSelector(SentinelAccount.OperatorNotAuthorized.selector, OPERATOR, uint8(3)));
        account.autoRepay();
        vm.warp(expiry);
        vm.prank(OPERATOR);
        vm.expectRevert(SentinelAccount.OperatorExpired.selector);
        account.borrow(1);
        require(debt.balanceOf(OPERATOR) == 0 && debt.balanceOf(address(account)) == 7e6);
    }

    function testRejectedMarketBorrowPreservesOperatorGrant() external {
        account.borrow(50e6);
        bytes32 tightMarket = _register(0, TightMarketFixture.PROGRAM, TightMarketFixture.CONFIG_HASH);
        controller.setPolicy(tightMarket);
        uint64 expiry = uint64(block.timestamp + 1 days);
        account.setOperator(OPERATOR, 4, 5e6, expiry);

        // The account policy permits 5,500 bps. The market denies above 5,000 bps.
        vm.prank(OPERATOR);
        vm.expectRevert(
            abi.encodeWithSelector(TapeOutPolicyAdapter.MarketPolicyRejected.selector, tightMarket, uint8(1))
        );
        account.borrow(5e6);
        (uint16 mask, uint256 remaining, uint64 expiresAt) = account.operators(OPERATOR);
        require(mask == 4 && remaining == 5e6 && expiresAt == expiry);
        require(debtMarket.borrowBalanceStored(address(account)) == 50e6);
        require(debt.balanceOf(address(account)) == 50e6 && debt.balanceOf(OPERATOR) == 0);

        controller.setPolicy(marketPolicy);
        vm.prank(OPERATOR);
        account.borrow(5e6);
        (, remaining,) = account.operators(OPERATOR);
        require(remaining == 0 && debtMarket.borrowBalanceStored(address(account)) == 55e6);
    }

    function testAccountFactoryAndWithdrawalScope() external {
        require(accounts.accountOf(address(this), address(controller)) == address(account));
        vm.expectRevert(abi.encodeWithSelector(SentinelAccountFactory.AccountAlreadyExists.selector, address(account)));
        accounts.createAccount(address(controller), accountPolicy);
        vm.expectRevert(SentinelAccountFactory.UnknownMarket.selector);
        accounts.createAccount(address(this), accountPolicy);
        vm.expectRevert(SentinelAccount.InvalidAsset.selector);
        account.withdraw(address(collateralMarket), 1);
        vm.expectRevert(abi.encodeWithSelector(PolicyRegistry.UnavailablePolicy.selector, marketPolicy));
        account.setPolicy(marketPolicy);
        vm.prank(OPERATOR);
        vm.expectRevert(SentinelAccount.OwnerOnly.selector);
        account.setPolicy(0);
    }
}
