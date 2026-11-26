// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Unforked local browser fixture. Both approved lending prices are fixed simulations.
contract LocalAcceptancePrices {
    address public immutable collateral;
    address public immutable debt;

    constructor(address collateral_, address debt_) {
        require(block.chainid == 31337 && collateral_.code.length > 0 && debt_.code.length > 0 && collateral_ != debt_);
        collateral = collateral_;
        debt = debt_;
    }

    function price(address asset) external view returns (uint256 usdWad, bool fresh) {
        if (asset == collateral) return (1.6 ether, true);
        if (asset == debt) return (1 ether, true);
        return (0, false);
    }
}
