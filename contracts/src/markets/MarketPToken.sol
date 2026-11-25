// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.26;

import {PErc20, EIP20Interface, PeridottrollerInterface, InterestRateModel} from "../core/PErc20.sol";
import {TestProfile} from "./TestProfile.sol";

/// @notice Fixed implementation of the Peridot ERC20 lending book for isolated test markets.
contract MarketPToken is PErc20, TestProfile {
    error UnsupportedTransfer();

    constructor() {
        admin = payable(address(this));
    }

    /// @dev Factory deploys and initializes a fresh clone in a single transaction.
    function initializeBook(address asset, address controller, address model) external {
        require(admin == address(0) && borrowIndex == 0);
        admin = payable(msg.sender);
        string memory ticker = EIP20Interface(asset).symbol();
        initialize(
            asset,
            PeridottrollerInterface(controller),
            InterestRateModel(model),
            1e18,
            string.concat("Peridot ", ticker),
            string.concat("p", ticker),
            EIP20Interface(asset).decimals()
        );
        flashLoansPaused = true;
        reserveFactorMantissa = 0.1e18;
        // The closed admin surface has no method to change rate, controller or flash-loan status.
        admin = payable(address(this));
    }

    function doTransferIn(address from, uint256 amount) internal override returns (uint256) {
        if (super.doTransferIn(from, amount) != amount) revert UnsupportedTransfer();
        return amount;
    }

    function doTransferOut(address payable to, uint256 amount) internal override {
        EIP20Interface token = EIP20Interface(underlying);
        uint256 beforeCash = token.balanceOf(address(this));
        uint256 beforeRecipient = token.balanceOf(to);
        super.doTransferOut(to, amount);
        if (beforeCash - token.balanceOf(address(this)) != amount || token.balanceOf(to) - beforeRecipient != amount) {
            revert UnsupportedTransfer();
        }
    }
}
