// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PolicyRegistry} from "../../src/policies/PolicyRegistry.sol";
import {DevelopmentReferenceProcessor} from "../../src/policies/DevelopmentReferenceProcessor.sol";
import {TapeOutPolicyAdapter} from "../../src/policies/TapeOutPolicyAdapter.sol";

/// @dev Functionality fixture for malformed or unavailable processor responses.
contract ResponseFixture {
    uint8 public mode;
    function setMode(uint8 m) external { mode = m; }
    function circuitInfo(uint256) external view returns (uint32,uint32,uint32,uint32) {
        return (20,1,mode == 7 ? 1 : 0,1);
    }
    function netlist(uint256) external pure returns(bytes memory) { return hex"00000001000001"; }
    function eval(uint256,bytes calldata) external view returns(bytes memory) {
        if (mode == 0) return hex"01";
        if (mode == 1) return hex"00";
        if (mode == 2) return hex"02";
        if (mode == 3) return hex"0001";
        if (mode == 4) revert();
        if (mode == 5) assembly { mstore(0,32) mstore(32,1) mstore(64,1) return(0,96) }
        assembly { return(0,4096) }
    }
}

contract PolicyTest {
    PolicyRegistry registry;
    TapeOutPolicyAdapter adapter;
    ResponseFixture processor;
    bytes32 policy;
    bytes32 constant CONFIG = keccak256("fixture config");

    function setUp() public {
        registry = new PolicyRegistry(address(this));
        adapter = new TapeOutPolicyAdapter(registry);
        processor = new ResponseFixture();
        registry.setProcessorTrust(address(processor), true);
        policy = register(0);
    }

    function register(uint8 kind) internal returns(bytes32) {
        return registry.register(address(processor), 1, kind, keccak256(processor.netlist(1)), CONFIG, 0);
    }

    function rejection(bytes32 id, uint8 kind, bytes4 reason) internal view {
        try adapter.enforce(id,kind,2,true,5000,true) { revert("expected failure"); }
        catch (bytes memory result) { require(bytes4(result) == reason, "wrong failure"); }
    }

    function testContextAndDecisions() public {
        require(keccak256(adapter.encodeContext(2,true,5000,true)) == keccak256(hex"12710a"));
        adapter.enforce(policy,0,2,true,5000,true);
        processor.setMode(1);
        rejection(policy,0,TapeOutPolicyAdapter.MarketPolicyRejected.selector);
        rejection(register(1),1,TapeOutPolicyAdapter.AccountPolicyRejected.selector);
        try adapter.encodeContext(2,true,10001,true) { revert(); }
        catch (bytes memory reason) { require(bytes4(reason) == TapeOutPolicyAdapter.InvalidContext.selector); }
    }

    function testMalformedAndFailedResponses() public {
        for(uint8 mode = 2; mode <= 6; ++mode) {
            processor.setMode(mode);
            rejection(policy,0,TapeOutPolicyAdapter.PolicyEvaluationFailed.selector);
        }
    }

    function testRegistrationConstraints() public {
        processor.setMode(7);
        try registry.register(address(processor),1,1,keccak256(processor.netlist(1)),CONFIG,0) { revert(); }
        catch(bytes memory reason) { require(bytes4(reason) == PolicyRegistry.InvalidCircuit.selector); }
        registry.setProcessorTrust(address(processor),false);
        rejection(policy,0,PolicyRegistry.UnavailablePolicy.selector);
    }

    function testReferenceEvaluatorUsesLiveInputs() public {
        DevelopmentReferenceProcessor referenceCpu = new DevelopmentReferenceProcessor();
        // Two NAND records buffer input bit 4 (signal 6), the fresh oracle flag.
        bytes memory program = hex"0000000600000600000016000016";
        uint256 id = referenceCpu.addReferenceCircuit(program);
        registry.setProcessorTrust(address(referenceCpu),true);
        bytes32 p = registry.register(address(referenceCpu),id,0,keccak256(program),CONFIG,0);
        adapter.enforce(p,0,2,true,5000,true);
        try adapter.enforce(p,0,2,false,5000,true) { revert(); }
        catch(bytes memory reason) { require(bytes4(reason) == TapeOutPolicyAdapter.MarketPolicyRejected.selector); }
    }
}
