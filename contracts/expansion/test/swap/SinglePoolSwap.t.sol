// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SinglePoolSwapAdapter} from "../../src/swap/SinglePoolSwapAdapter.sol";
import {TestnetInventoryVenue, TestnetSwapQuoteSource} from "../../src/swap/TestnetInventoryVenue.sol";

contract UnitToken is ERC20 {
    uint8 immutable precision;

    constructor(uint8 d) ERC20("Test", "T") {
        precision = d;
    }

    function decimals() public view override returns (uint8) {
        return precision;
    }

    function mint(address owner, uint256 amount) external {
        _mint(owner, amount);
    }
}

interface VmSwap {
    function warp(uint256) external;
    function expectRevert(bytes4) external;
}

contract SinglePoolSwapTest {
    VmSwap constant vm = VmSwap(address(uint160(uint256(keccak256("hevm cheat code")))));
    UnitToken a;
    UnitToken b;
    TestnetInventoryVenue venue;
    SinglePoolSwapAdapter adapter;
    uint64 asOf;

    function quotes(address asset) external view returns (uint192, uint64) {
        return (asset == address(a) ? uint192(80e18) : uint192(1e18), asOf);
    }

    function setUp() public {
        vm.warp(1_000_000);
        asOf = uint64(block.timestamp);
        a = new UnitToken(18);
        b = new UnitToken(6);
        TestnetSwapQuoteSource source = new TestnetSwapQuoteSource(address(this));
        venue = new TestnetInventoryVenue(address(a), address(b), 80e18, 1e18);
        adapter = new SinglePoolSwapAdapter(
            address(venue), address(venue), address(a), address(b), address(source), 3600, 500
        );
        a.mint(address(this), 10e18);
        b.mint(address(venue), 800e6);
        a.approve(address(adapter), 1e18);
    }

    function testBothDirectionsPaySameAccountAndClearApprovals() public {
        (uint256 expected, uint256 floor, uint256 ts) = adapter.executionQuote(address(a), 1e18);
        require(expected == 80e6 && floor == 76e6 && ts == block.timestamp);
        uint256 out = adapter.swapExactIn(address(a), 1e18, floor, uint64(block.timestamp));
        require(out == 79_960_000 && b.balanceOf(address(this)) == out && a.balanceOf(address(venue)) == 1e18);
        b.approve(address(adapter), out);
        (, uint256 reverseFloor,) = adapter.executionQuote(address(b), out);
        uint256 reverse = adapter.swapExactIn(address(b), out, reverseFloor, uint64(block.timestamp));
        require(a.balanceOf(address(this)) == 9e18 + reverse);
        require(
            a.allowance(address(adapter), address(venue)) == 0 && b.allowance(address(adapter), address(venue)) == 0
        );
    }

    function testDirectCallerCannotBypassOracleLossFloor() public {
        vm.expectRevert(SinglePoolSwapAdapter.SlippageLimit.selector);
        adapter.swapExactIn(address(a), 1e18, 76e6 - 1, uint64(block.timestamp));
        require(a.balanceOf(address(this)) == 10e18 && b.balanceOf(address(venue)) == 800e6);
    }

    function testExpiredDeadlineStaleFutureZeroAndWrongAsset() public {
        vm.expectRevert(SinglePoolSwapAdapter.DeadlineExpired.selector);
        adapter.swapExactIn(address(a), 1e18, 76e6, 1);
        vm.expectRevert(SinglePoolSwapAdapter.InvalidAsset.selector);
        adapter.executionQuote(address(this), 1e18);
        asOf = uint64(block.timestamp + 1);
        vm.expectRevert(SinglePoolSwapAdapter.QuoteExpired.selector);
        adapter.executionQuote(address(a), 1e18);
        asOf = uint64(block.timestamp - 3601);
        vm.expectRevert(SinglePoolSwapAdapter.QuoteExpired.selector);
        adapter.swapExactIn(address(a), 1e18, 76e6, uint64(block.timestamp));
        asOf = 0;
        vm.expectRevert(SinglePoolSwapAdapter.QuoteExpired.selector);
        adapter.executionQuote(address(a), 1e18);
    }

    function testInsufficientInventoryRollsBackTransfersAndApproval() public {
        a.mint(address(this), 1e18);
        a.approve(address(adapter), 11e18);
        vm.expectRevert(TestnetInventoryVenue.InsufficientOutput.selector);
        adapter.swapExactIn(address(a), 11e18, 840e6, uint64(block.timestamp));
        require(a.balanceOf(address(this)) == 11e18 && a.allowance(address(adapter), address(venue)) == 0);
        require(a.balanceOf(address(adapter)) == 0 && a.allowance(address(this), address(adapter)) == 11e18);
    }
}
