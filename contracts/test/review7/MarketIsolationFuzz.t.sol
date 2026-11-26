// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MarketTest, VmMarket} from "../markets/Market.t.sol";
import {IsolatedController} from "../../src/markets/IsolatedController.sol";
import {MarketPToken} from "../../src/markets/MarketPToken.sol";

contract MarketIsolationFuzzTest is MarketTest {
    VmMarket constant cheats = VmMarket(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant BORROWER = address(0xa11ce);

    function testFreshTestnetPriceRemainsAnOwnerAssertion() external {
        controller.activate();
        cheats.prank(BORROWER);
        require(pd.borrow(50e6) == 0 && controller.currentLtvBps(BORROWER) == 2500);
        cheats.prank(BORROWER);
        (bool written,) = address(oracle).call(abi.encodeCall(oracle.setPrice, (address(col), 1e18)));
        require(!written && controller.currentLtvBps(BORROWER) == 2500);
        oracle.setPrice(address(col), 1e18);
        (uint256 price, bool fresh) = oracle.price(address(col));
        require(price == 1e18 && fresh && controller.currentLtvBps(BORROWER) == 5000);
        cheats.warp(block.timestamp + 1 days + 1);
        cheats.expectRevert(IsolatedController.InvalidOracle.selector);
        controller.currentLtvBps(BORROWER);
    }

    function testFuzz_SecondBookRequiresSeparateCollateral(uint64 seed) external {
        uint256 amount = 1 + uint256(seed) % 90e6;
        controller.activate();
        cheats.prank(BORROWER);
        require(pd.borrow(amount) == 0);

        bytes32 sharedPolicy = controller.policyId();
        IsolatedController other =
            IsolatedController(factory.createMarket(sharedPolicy, 7500, 8500, 500e18, 1000e6, 900e6, 10e6));
        MarketPToken secondDebt = other.debtMarket();
        debt.mint(address(this), 200e6);
        debt.approve(address(secondDebt), 200e6);
        require(secondDebt.mint(200e6) == 0);
        other.activate();
        cheats.startPrank(BORROWER);
        address[] memory books = new address[](1);
        books[0] = address(pc);
        cheats.expectRevert(IsolatedController.InvalidMarket.selector);
        other.enterMarkets(books);
        cheats.expectRevert(IsolatedController.InsufficientLiquidity.selector);
        secondDebt.borrow(amount);
        // A remains fully repayable; B retains its independently supplied liquidity.
        debt.approve(address(pd), amount);
        require(pd.repayBorrow(amount) == 0);
        cheats.stopPrank();
        require(pd.borrowBalanceStored(BORROWER) == 0 && pd.getCash() == 200e6);
        require(secondDebt.borrowBalanceStored(BORROWER) == 0 && secondDebt.getCash() == 200e6);
        require(pc.balanceOf(BORROWER) == 100e18 && other.collateralMarket().balanceOf(BORROWER) == 0);
    }
}
