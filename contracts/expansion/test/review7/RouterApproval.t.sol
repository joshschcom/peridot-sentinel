// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SinglePoolSwapTest} from "../swap/SinglePoolSwap.t.sol";
import {SinglePoolSwapAdapter} from "../../src/swap/SinglePoolSwapAdapter.sol";
import {CheckedSinglePoolSwapAdapter} from "../../src/review7/CheckedSinglePoolSwapAdapter.sol";
import {ReviewVm} from "./ReviewFixture.sol";

interface ReviewSwap {
    function swapExactIn(address tokenIn, uint256 amountIn, uint256 minOut, uint64 deadline) external returns (uint256);
}

contract RouterApprovalTest is SinglePoolSwapTest {
    ReviewVm private constant checks = ReviewVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function _candidate() private returns (ReviewSwap) {
        return ReviewSwap(
            address(
                new CheckedSinglePoolSwapAdapter(
                    adapter.router(),
                    adapter.factory(),
                    address(a),
                    address(b),
                    address(adapter.priceSource()),
                    adapter.maxAge(),
                    adapter.hardSlippageBps()
                )
            )
        );
    }

    function testCheckedRouterSettlesAndResetsForSupportedAssets() public {
        ReviewSwap candidate = _candidate();
        a.approve(address(candidate), 1e18);
        uint256 out = candidate.swapExactIn(address(a), 1e18, 79e6, uint64(block.timestamp));
        require(out == 79_960_000 && b.balanceOf(address(this)) == out);
        require(a.allowance(address(candidate), address(venue)) == 0);
    }

    function testRouterReadsBackExactApprovalBeforeUse() public {
        // Set only for the explicit red control on the pinned legacy source.
        ReviewSwap candidate =
            checks.envOr("REVIEW7_LEGACY_ADAPTER", false) ? ReviewSwap(address(adapter)) : _candidate();
        a.approve(address(candidate), 1e18);
        // Standard approve/transferFrom still operate. Only the reported allowance is inconsistent.
        checks.mockCall(
            address(a), abi.encodeCall(IERC20.allowance, (address(candidate), address(venue))), abi.encode(0)
        );
        checks.expectRevert(SinglePoolSwapAdapter.SettlementMismatch.selector);
        candidate.swapExactIn(address(a), 1e18, 79e6, uint64(block.timestamp));
        checks.clearMockedCalls();
        require(a.balanceOf(address(this)) == 10e18 && b.balanceOf(address(this)) == 0);
        require(a.allowance(address(this), address(candidate)) == 1e18);
    }
}
