// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ExecutionPolicy} from "../../src/policy/ExecutionPolicy.sol";

interface PolicyVm {
    function getCode(string calldata) external returns (bytes memory);
    function readFile(string calldata) external returns (string memory);
    function parseJsonBytes(string calldata, string calldata) external returns (bytes memory);
    function expectRevert(bytes4) external;
    function mockCall(address,bytes calldata,bytes calldata) external;
}

interface ReferenceCPU {
    function addReferenceCircuit(bytes calldata) external returns(uint256);
}

contract ExecutionPolicyTest {
    PolicyVm constant vm = PolicyVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    ExecutionPolicy policy;
    address cpu;
    function setUp() public {
        bytes memory creation = vm.getCode("../out/DevelopmentReferenceProcessor.sol/DevelopmentReferenceProcessor.json");
        assembly ("memory-safe") { sstore(cpu.slot, create(0, add(creation,32), mload(creation))) }
        require(cpu.code.length != 0);
        bytes memory program = vm.parseJsonBytes(vm.readFile("policy/execution.json"), ".netlist");
        policy = new ExecutionPolicy(cpu,ReferenceCPU(cpu).addReferenceCircuit(program));
    }
    function testBoundaryAndFlags() public {
        require(keccak256(policy.encodeSwap(15,100)) == keccak256(hex"f56400"));
        policy.enforceSwap(15,0);
        policy.enforceSwap(15,100);
        vm.expectRevert(ExecutionPolicy.ExecutionPolicyDenied.selector);
        policy.enforceSwap(15,101);
        for (uint8 i; i<4; i++) {
            vm.expectRevert(ExecutionPolicy.ExecutionPolicyDenied.selector);
            policy.enforceSwap(15 ^ (uint8(1)<<i),0);
        }
    }
    function testRejectsWrongNetlistAndMalformedDecision() public {
        bytes memory impostor = new bytes(7*59);
        uint256 id = ReferenceCPU(cpu).addReferenceCircuit(impostor);
        vm.expectRevert(ExecutionPolicy.InvalidCircuit.selector);
        new ExecutionPolicy(cpu,id);
        vm.mockCall(cpu,abi.encodeWithSignature("eval(uint256,bytes)",1,hex"f50000"),abi.encode(hex"02"));
        vm.expectRevert(ExecutionPolicy.ExecutionEvaluationFailed.selector);
        policy.enforceSwap(15,0);
    }
}
