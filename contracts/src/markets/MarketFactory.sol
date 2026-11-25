// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IsolatedController} from "./IsolatedController.sol";
import {MarketPToken} from "./MarketPToken.sol";
import {EIP20Interface} from "../core/EIP20Interface.sol";
import {TestProfile} from "./TestProfile.sol";

/// @notice Creates independent lending books for the immutable, deployment-approved test asset pair.
contract MarketFactory is TestProfile {
    address public immutable registry;
    address public immutable adapter;
    address public immutable oracle;
    address public immutable rateModel;
    address public immutable pTokenImplementation;
    address public immutable approvedCollateral;
    address public immutable approvedDebt;

    address[] public marketAt;
    mapping(address => bool) public isMarket;

    event MarketCreated(
        uint256 indexed marketId,
        address indexed owner,
        address indexed controller,
        bytes32 policyId,
        address collateralMarket,
        address debtMarket
    );

    constructor(
        address registry_,
        address adapter_,
        address oracle_,
        address rateModel_,
        address pTokenImplementation_,
        address approvedCollateral_,
        address approvedDebt_
    ) {
        require(
            registry_.code.length != 0 && adapter_.code.length != 0 && oracle_.code.length != 0
                && rateModel_.code.length != 0 && pTokenImplementation_.code.length != 0
        );
        require(
            approvedCollateral_ != approvedDebt_ && EIP20Interface(approvedCollateral_).decimals() <= 18
                && EIP20Interface(approvedDebt_).decimals() <= 18
        );
        registry = registry_;
        adapter = adapter_;
        oracle = oracle_;
        rateModel = rateModel_;
        pTokenImplementation = pTokenImplementation_;
        approvedCollateral = approvedCollateral_;
        approvedDebt = approvedDebt_;
    }

    function marketCount() external view returns (uint256) {
        return marketAt.length;
    }

    function createMarket(
        bytes32 policyId,
        uint16 borrowLtvBps,
        uint16 liquidationLtvBps,
        uint128 collateralSupplyCap,
        uint128 debtSupplyCap,
        uint128 borrowCap,
        uint128 minCash
    ) external returns (address controller) {
        address col = Clones.clone(pTokenImplementation);
        address debt = Clones.clone(pTokenImplementation);
        IsolatedController.Limits memory limits = IsolatedController.Limits(
            borrowLtvBps, liquidationLtvBps, collateralSupplyCap, debtSupplyCap, borrowCap, minCash
        );
        controller = address(
            new IsolatedController(
                msg.sender, approvedCollateral, approvedDebt, col, debt, registry, adapter, oracle, policyId, limits
            )
        );
        MarketPToken(col).initializeBook(approvedCollateral, controller, rateModel);
        MarketPToken(debt).initializeBook(approvedDebt, controller, rateModel);
        uint256 id = marketAt.length;
        marketAt.push(controller);
        isMarket[controller] = true;
        emit MarketCreated(id, msg.sender, controller, policyId, col, debt);
    }
}
