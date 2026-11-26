// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    PeridotLendingAdapter,
    IV2MarketFactory,
    IV2IsolatedController,
    IV2MarketBook
} from "../../src/account/PeridotLendingAdapter.sol";
import {SentinelAccountV2, IV2SwapAdapter, IV2ExecutionPolicy} from "../../src/account/SentinelAccountV2.sol";
import {SentinelAccountFactoryV2} from "../../src/account/SentinelAccountFactoryV2.sol";
import {ExecutionPolicy} from "../../src/policy/ExecutionPolicy.sol";
import {SinglePoolSwapAdapter} from "../../src/swap/SinglePoolSwapAdapter.sol";
import {TestnetInventoryVenue, TestnetSwapQuoteSource} from "../../src/swap/TestnetInventoryVenue.sol";

interface AccountVm {
    function getCode(string calldata artifact) external returns (bytes memory);
    function readFile(string calldata path) external view returns (string memory);
    function parseJsonBytes(string calldata data, string calldata path) external pure returns (bytes memory);
    function parseJsonBytes32(string calldata data, string calldata path) external pure returns (bytes32);
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
    function roll(uint256 blockNumber) external;
    function mockCall(address target, bytes calldata input, bytes calldata result) external;
    function expectRevert(bytes4 reason) external;
    function expectRevert(bytes calldata reason) external;
    function etch(address target, bytes calldata code) external;
}

interface FixtureToken is IERC20 {
    function mint(address to, uint256 amount) external;
}

interface FixtureOracle {
    function setPrice(address token, uint256 value) external;
}

interface LendingFactory is IV2MarketFactory {
    function createMarket(bytes32, uint16, uint16, uint128, uint128, uint128, uint128) external returns (address);
}

interface LendingController is IV2IsolatedController {
    function activate() external;
    function setPolicy(bytes32 id) external;
}

interface LendingRegistry {
    function setProcessorTrust(address processor, bool trusted) external;
    function register(
        address processor,
        uint256 circuitId,
        uint8 kind,
        bytes32 netlist,
        bytes32 config,
        bytes32 metadata
    ) external returns (bytes32 policy);
}

interface ReferenceInterpreter {
    function addReferenceCircuit(bytes calldata netlist) external returns (uint256);
}

/// @notice Uses compiled V1 market, books, adapters and dev-only interpreter. Swaps settle at the labeled inventory venue.
contract SentinelAccountV2Test {
    AccountVm constant vm = AccountVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant OPERATOR = address(0xB0B);
    FixtureToken col;
    FixtureToken debt;
    FixtureOracle oracle;
    ReferenceInterpreter cpu;
    LendingRegistry registry;
    LendingController controller;
    PeridotLendingAdapter lending;
    IV2SwapAdapter swap;
    IV2ExecutionPolicy execution;
    TestnetInventoryVenue venue;
    SentinelAccountFactoryV2 factory;
    SentinelAccountV2 account;
    IV2MarketBook shares;
    IV2MarketBook loans;
    bytes32 marketPolicy;
    bytes32 accountPolicy;

    function _artifact(string memory dir, string memory name, bytes memory args) private returns (address deployed) {
        bytes memory init = bytes.concat(vm.getCode(string.concat(dir, "/", name, ".sol/", name, ".json")), args);
        assembly ("memory-safe") {
            deployed := create(0, add(init, 32), mload(init))
        }
        require(deployed.code.length > 0, name);
    }

    function _register(uint8 kind, bytes memory netlist, bytes32 config) private returns (bytes32) {
        uint256 id = cpu.addReferenceCircuit(netlist);
        return registry.register(address(cpu), id, kind, keccak256(netlist), config, 0);
    }

    function _configureLending() private {
        registry = LendingRegistry(_artifact("../out", "PolicyRegistry", abi.encode(address(this))));
        cpu = ReferenceInterpreter(_artifact("../out", "DevelopmentReferenceProcessor", ""));
        registry.setProcessorTrust(address(cpu), true);
        string memory fixture = vm.readFile("../../packages/circuit-sdk/fixtures/policies-v1.json");
        marketPolicy = _register(
            0,
            vm.parseJsonBytes(fixture, ".policies[0].netlist"),
            vm.parseJsonBytes32(fixture, ".policies[0].configHash")
        );
        accountPolicy = _register(
            1,
            vm.parseJsonBytes(fixture, ".policies[1].netlist"),
            vm.parseJsonBytes32(fixture, ".policies[1].configHash")
        );
        col = FixtureToken(_artifact("../out", "TestnetToken", abi.encode("Mock Collateral", "mCOL", uint8(18))));
        debt = FixtureToken(_artifact("../out", "TestnetToken", abi.encode("Mock USD", "mUSD", uint8(6))));
        oracle = FixtureOracle(_artifact("../out", "TestnetOracle", ""));
        oracle.setPrice(address(col), 1e18);
        oracle.setPrice(address(debt), 1e18);
        address rate = _artifact("../out", "DemoRateModel", abi.encode(31_536_000));
        address implementation = _artifact("../out", "MarketPToken", "");
        address policyAdapter = _artifact("../out", "TapeOutPolicyAdapter", abi.encode(registry));
        LendingFactory markets = LendingFactory(
            _artifact(
                "../out", "MarketFactory", abi.encode(registry, policyAdapter, oracle, rate, implementation, col, debt)
            )
        );
        controller = LendingController(markets.createMarket(marketPolicy, 7500, 8500, 500e18, 1000e6, 900e6, 10e6));
        lending = new PeridotLendingAdapter(markets, controller);
        shares = controller.collateralMarket();
        loans = controller.debtMarket();
        debt.mint(address(this), 200e6);
        debt.approve(address(loans), 200e6);
        require(loans.mint(200e6) == 0);
        controller.activate();
    }

    function setUp() external {
        _configureLending();
        bytes memory program = vm.parseJsonBytes(vm.readFile("policy/execution.json"), ".netlist");
        execution = IV2ExecutionPolicy(address(new ExecutionPolicy(address(cpu), cpu.addReferenceCircuit(program))));
        venue = new TestnetInventoryVenue(address(col), address(debt), 1e18, 1e18);
        address source = address(new TestnetSwapQuoteSource(address(oracle)));
        swap = IV2SwapAdapter(
            address(
                new SinglePoolSwapAdapter(
                    address(venue), address(venue), address(col), address(debt), source, 1 days, 500
                )
            )
        );
        debt.mint(address(venue), 100e6);
        factory = SentinelAccountFactoryV2(
            _artifact("out", "SentinelAccountFactoryV2", abi.encode(lending, swap, execution))
        );
        account = SentinelAccountV2(factory.createAccount(accountPolicy));
        col.mint(address(account), 110e18);
        account.enterCollateral();
        account.supply(100e18);
    }

    function _grant(address adapter, uint8 op, address input, uint256 perCall, uint256 cumulative) private {
        account.setGrant(OPERATOR, adapter, op, input, perCall, cumulative, uint64(block.timestamp + 1 days));
    }

    function _remaining(address adapter, uint8 op, address input) private view returns (uint256 amount) {
        (, amount,) = account.grants(OPERATOR, adapter, op, input);
    }

    function testBookOwnershipAndSeparateMarketAndAccountDecisions() external {
        account.borrow(50e6);
        (uint256 collateralShares, uint256 debtRaw) = account.exposure();
        require(collateralShares == 100e18 && debtRaw == 50e6);
        require(shares.balanceOf(address(lending)) == 0 && loans.borrowBalanceStored(address(lending)) == 0);
        require(debt.balanceOf(address(account)) == 50e6 && debt.balanceOf(address(this)) == 0);
        account.borrow(5e6);
        bytes memory accountDenied =
            abi.encodeWithSignature("AccountPolicyRejected(bytes32,uint8)", accountPolicy, uint8(1));
        vm.expectRevert(accountDenied);
        account.borrow(1);
        vm.expectRevert(accountDenied);
        account.redeem(1e18);
        account.repay(1e6);
        // Local one-NAND deny-all market fixture. Its output is independent of the account's accepted post-LTV.
        bytes32 deny = _register(0, hex"00000015000015", keccak256("test-market-deny"));
        controller.setPolicy(deny);
        vm.expectRevert(abi.encodeWithSignature("MarketPolicyRejected(bytes32,uint8)", deny, uint8(1)));
        account.borrow(1);
        require(loans.borrowBalanceStored(address(account)) == 54e6);
    }

    function testRepaymentAndOwnerExitDuringOutage() external {
        account.borrow(50e6);
        account.withdraw(address(debt), 2e6);
        _grant(address(lending), 3, address(debt), 48e6, 50e6);
        account.setPolicy(0);
        registry.setProcessorTrust(address(cpu), false);
        vm.etch(address(execution), hex"00");
        vm.prank(OPERATOR);
        require(account.repay(type(uint256).max) == 48e6);
        require(_remaining(address(lending), 3, address(debt)) == 2e6);
        vm.warp(block.timestamp + 2 days);
        debt.transfer(address(account), 2e6);
        require(account.repay(type(uint256).max) == 2e6);
        account.redeem(100e18);
        account.withdraw(address(col), 110e18);
        require(col.balanceOf(address(this)) == 110e18 && loans.borrowBalanceStored(address(account)) == 0);
        require(
            debt.allowance(address(account), address(loans)) == 0
                && col.allowance(address(account), address(shares)) == 0
        );
    }

    function testRoundedShareConversionsAndAccruedDebtDeltas() external {
        // A book donation makes one share worth 1.5 underlying. The book rounds both conversions down.
        col.mint(address(shares), 50e18);
        uint256 idleBefore = col.balanceOf(address(account));
        account.supply(5);
        require(shares.balanceOf(address(account)) == 100e18 + 3);
        account.redeem(3);
        require(col.balanceOf(address(account)) == idleBefore - 1);
        account.borrow(20e6);
        vm.roll(block.number + 86_400);
        uint256 accruedDebt = loans.borrowBalanceCurrent(address(account));
        require(accruedDebt > 20e6);
        account.borrow(123);
        require(loans.borrowBalanceStored(address(account)) == accruedDebt + 123);
        account.repay(5e6);
        require(loans.borrowBalanceStored(address(account)) == accruedDebt + 123 - 5e6);
    }

    function testSuccessfulReturnCodeAloneCannotSettleAnOperation() external {
        account.borrow(10e6);
        vm.mockCall(address(shares), abi.encodeCall(IV2MarketBook.mint, (1e18)), abi.encode(uint256(0)));
        vm.expectRevert(SentinelAccountV2.UnexpectedSettlement.selector);
        account.supply(1e18);
        vm.mockCall(address(shares), abi.encodeCall(IV2MarketBook.redeem, (1e18)), abi.encode(uint256(0)));
        vm.expectRevert(SentinelAccountV2.UnexpectedSettlement.selector);
        account.redeem(1e18);
        vm.mockCall(address(loans), abi.encodeCall(IV2MarketBook.borrow, (1e6)), abi.encode(uint256(0)));
        vm.expectRevert(SentinelAccountV2.UnexpectedSettlement.selector);
        account.borrow(1e6);
        vm.mockCall(address(loans), abi.encodeCall(IV2MarketBook.repayBorrow, (1e6)), abi.encode(uint256(0)));
        vm.expectRevert(SentinelAccountV2.UnexpectedSettlement.selector);
        account.repay(1e6);
        require(
            col.allowance(address(account), address(shares)) == 0
                && debt.allowance(address(account), address(loans)) == 0
        );
        require(shares.balanceOf(address(account)) == 100e18 && loans.borrowBalanceStored(address(account)) == 10e6);
    }

    function testPerCallAndCumulativeBoundsAndScopedRevocation() external {
        _grant(address(lending), 2, address(debt), 6e6, 10e6);
        _grant(address(lending), 0, address(col), 1e18, 2e18);
        vm.prank(OPERATOR);
        vm.expectRevert(SentinelAccountV2.BudgetExceeded.selector);
        account.borrow(6e6 + 1);
        vm.prank(OPERATOR);
        account.borrow(6e6);
        vm.prank(OPERATOR);
        vm.expectRevert(SentinelAccountV2.BudgetExceeded.selector);
        account.borrow(4e6 + 1);
        require(_remaining(address(lending), 2, address(debt)) == 4e6);
        vm.prank(OPERATOR);
        vm.expectRevert(SentinelAccountV2.OperatorNotAuthorized.selector);
        account.repay(1e6);
        account.revokeGrant(OPERATOR, address(lending), 2, address(debt));
        vm.prank(OPERATOR);
        vm.expectRevert(SentinelAccountV2.OperatorNotAuthorized.selector);
        account.borrow(1);
        vm.prank(OPERATOR);
        account.supply(1e18);
        require(shares.balanceOf(address(account)) == 101e18 && _remaining(address(lending), 0, address(col)) == 1e18);
        vm.warp(block.timestamp + 1 days);
        vm.prank(OPERATOR);
        vm.expectRevert(SentinelAccountV2.OperatorExpired.selector);
        account.supply(1);
    }

    function testSwapBalancesAllowCircuitAt100DenyAt101AndRollbackGrant() external {
        _grant(address(swap), 5, address(col), 1e18, 2e18);
        uint64 deadline = uint64(block.timestamp + 300);
        vm.prank(OPERATOR);
        vm.expectRevert(ExecutionPolicy.ExecutionPolicyDenied.selector);
        account.swapExactIn(address(col), 1e18, 989_999, deadline); // 100.01 bps rounds up to 101.
        require(_remaining(address(swap), 5, address(col)) == 2e18);
        vm.prank(OPERATOR);
        require(account.swapExactIn(address(col), 1e18, 990_000, deadline) == 999_500);
        require(col.balanceOf(address(account)) == 9e18 && debt.balanceOf(address(account)) == 999_500);
        require(debt.balanceOf(OPERATOR) == 0 && debt.balanceOf(address(swap)) == 0);
        require(
            col.allowance(address(account), address(swap)) == 0 && col.allowance(address(swap), address(venue)) == 0
        );
        require(_remaining(address(swap), 5, address(col)) == 1e18);
        vm.prank(OPERATOR);
        vm.expectRevert(SentinelAccountV2.OperatorNotAuthorized.selector);
        account.swapExactIn(address(debt), 100_000, 0.099e18, deadline);
        vm.prank(OPERATOR);
        vm.expectRevert(SentinelAccountV2.OwnerOnly.selector);
        account.withdraw(address(debt), 999_500);
        require(shares.balanceOf(address(account)) == 100e18 && loans.borrowBalanceStored(address(account)) == 0);
    }

    function testSwapHardStopsAndPinnedBindings() external {
        uint64 deadline = uint64(block.timestamp + 1);
        vm.expectRevert(SentinelAccountV2.SlippageExceeded.selector);
        account.swapExactIn(address(col), 1e18, 949_999, deadline);
        vm.expectRevert(SentinelAccountV2.InsufficientInput.selector);
        account.swapExactIn(address(col), 11e18, 11e6, deadline);
        vm.expectRevert(SentinelAccountV2.InvalidAsset.selector);
        account.swapExactIn(address(shares), 1e18, 1e6, deadline);
        vm.warp(uint256(deadline) + 1 days + 1);
        vm.expectRevert(SentinelAccountV2.DeadlineExpired.selector);
        account.swapExactIn(address(col), 1e18, 1e6, deadline);
        vm.expectRevert(SinglePoolSwapAdapter.QuoteExpired.selector);
        account.swapExactIn(address(col), 1e18, 1e6, type(uint64).max);
        vm.etch(address(swap), hex"00");
        vm.expectRevert(SentinelAccountV2.AdapterChanged.selector);
        account.swapExactIn(address(col), 1e18, 1e6, type(uint64).max);
        vm.prank(OPERATOR);
        vm.expectRevert(SentinelAccountFactoryV2.AdapterChanged.selector);
        factory.createAccount(accountPolicy);
    }

    function testFactoryAndOwnerPermissions() external {
        require(factory.accountOf(address(this)) == address(account) && account.owner() == address(this));
        vm.expectRevert(
            abi.encodeWithSelector(SentinelAccountFactoryV2.AccountAlreadyExists.selector, address(account))
        );
        factory.createAccount(accountPolicy);
        vm.prank(OPERATOR);
        vm.expectRevert(SentinelAccountV2.OwnerOnly.selector);
        account.setPolicy(0);
        vm.prank(OPERATOR);
        vm.expectRevert(SentinelAccountV2.OwnerOnly.selector);
        account.setGrant(OPERATOR, address(swap), 5, address(col), 1, 1, type(uint64).max);
        vm.expectRevert(SentinelAccountV2.InvalidGrant.selector);
        account.setGrant(OPERATOR, address(lending), 1, address(col), 1, 1, type(uint64).max);
        vm.expectRevert(SentinelAccountV2.InvalidGrant.selector);
        account.setGrant(OPERATOR, address(swap), 2, address(debt), 1, 1, type(uint64).max);
        vm.expectRevert(SentinelAccountV2.InvalidAsset.selector);
        account.withdraw(address(shares), 1);
        vm.prank(OPERATOR);
        address other = factory.createAccount(accountPolicy);
        require(other != address(account) && shares.balanceOf(other) == 0 && loans.borrowBalanceStored(other) == 0);
    }
}
