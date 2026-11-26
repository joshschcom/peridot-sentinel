// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IExecutionProcessor {
    function circuitInfo(uint256 id) external view returns (uint32, uint32, uint32, uint32);
    function netlist(uint256 id) external view returns (bytes memory);
    function eval(uint256 id, bytes calldata context) external view returns (bytes memory);
}

/// @notice Fixed Sentinel Circuits swap program. Construction verifies its exact compiled instructions.
contract ExecutionPolicy {
    bytes32 public constant NETLIST_HASH = 0x898674f49c1caa2e3196f31ce7afe18fa839d6260d5f75ebc4cd2248d266b30b;
    uint256 public constant EVAL_GAS = 1_500_000;
    address public immutable processor;
    bytes32 public immutable processorCodeHash;
    uint256 public immutable circuitId;

    error InvalidCircuit();
    error InvalidContext();
    error ExecutionEvaluationFailed();
    error ExecutionPolicyDenied();

    constructor(address processor_, uint256 id) {
        if (block.chainid != 1952 && block.chainid != 31337) revert InvalidCircuit();
        if (processor_.code.length == 0) revert InvalidCircuit();
        IExecutionProcessor cpu = IExecutionProcessor(processor_);
        (uint32 inputs, uint32 outputs, uint32 state, uint32 gates) = cpu.circuitInfo(id);
        if (inputs != 20 || outputs != 1 || state != 0 || gates != 59) revert InvalidCircuit();
        if (keccak256(cpu.netlist(id)) != NETLIST_HASH) revert InvalidCircuit();
        processor = processor_;
        processorCodeHash = processor_.codehash;
        circuitId = id;
    }

    function encodeSwap(uint8 checks, uint16 slippageBps) public pure returns (bytes memory) {
        if (checks > 15 || slippageBps > 1023) revert InvalidContext();
        return abi.encodePacked(uint8(5 | (checks << 4)), uint8(slippageBps), uint8(slippageBps >> 8));
    }

    function enforceSwap(uint8 checks, uint16 slippageBps) external view {
        address target = processor;
        if (target.codehash != processorCodeHash) revert ExecutionEvaluationFailed();
        bytes memory callData = abi.encodeCall(IExecutionProcessor.eval, (circuitId, encodeSwap(checks, slippageBps)));
        bool valid;
        uint256 word;
        assembly ("memory-safe") {
            let p := mload(0x40)
            let ok := staticcall(EVAL_GAS, target, add(callData,32), mload(callData), p, 96)
            valid := and(and(ok, eq(returndatasize(),96)), and(eq(mload(p),32),eq(mload(add(p,32)),1)))
            word := mload(add(p,64))
        }
        if (!valid || (word != 0 && word != 1 << 248)) revert ExecutionEvaluationFailed();
        if (word == 0) revert ExecutionPolicyDenied();
    }
}
