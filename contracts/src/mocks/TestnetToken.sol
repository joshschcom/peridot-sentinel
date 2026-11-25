// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {TestProfile} from "../markets/TestProfile.sol";

/// @notice Valueless, permissionlessly mintable testnet fixture.
contract TestnetToken is ERC20, TestProfile {
    uint8 private immutable precision;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        require(decimals_ <= 18);
        precision = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return precision;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
