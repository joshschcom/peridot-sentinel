// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MarketFactory} from "../markets/MarketFactory.sol";
import {IsolatedController} from "../markets/IsolatedController.sol";
import {TestProfile} from "../markets/TestProfile.sol";
import {SentinelAccount} from "./SentinelAccount.sol";

contract SentinelAccountFactory is TestProfile {
    MarketFactory public immutable marketFactory;
    mapping(address owner => mapping(address controller => address)) public accountOf;

    error UnknownMarket();
    error AccountAlreadyExists(address existing);

    event AccountCreated(address indexed owner, address indexed controller, address indexed account, bytes32 policyId);

    constructor(MarketFactory markets) {
        if (address(markets).code.length == 0) revert UnknownMarket();
        marketFactory = markets;
    }

    function createAccount(address controller, bytes32 accountPolicyId) external returns (address account) {
        if (!marketFactory.isMarket(controller)) revert UnknownMarket();
        address existing = accountOf[msg.sender][controller];
        if (existing != address(0)) revert AccountAlreadyExists(existing);
        account = address(new SentinelAccount(msg.sender, IsolatedController(controller), accountPolicyId));
        accountOf[msg.sender][controller] = account;
        emit AccountCreated(msg.sender, controller, account, accountPolicyId);
    }
}
