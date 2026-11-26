// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IWitnessCPU {
    function circuitInfo(uint256 id) external view returns (uint32, uint32, uint32, uint32);
    function netlist(uint256 id) external view returns (bytes memory);
    function eval(uint256 id, bytes calldata inputs) external view returns (bytes memory);
}

interface IWitnessFactory {
    function cpuAt(uint256 index) external view returns (address);
    function isCPU(address cpu) external view returns (bool);
}

interface IWitnessBeacon {
    function implementation() external view returns (address);
}

/// @notice Read-only witness for three fixed Peridot programs on X Layer CPU 410.
/// @dev The supplied context is an illustration. The financial account constructs its own context on the fork.
contract NativeCircuitWitness {
    address public constant CPU = 0x423446EEFAa885B804C7bD9B0bdD130cE2Ee00B5;
    address private constant FACTORY = 0x1f09DAeFA827f02CBb40967cc91b259763760761;
    address private constant BEACON = 0xf70d1ed4f62CF3780157B0b421b7E2F45bD0991C;
    address private constant IMPLEMENTATION = 0x977f217887E085D298Cb3819cDAD5A0ee35F29B2;
    uint256 public immutable marketId;
    uint256 public immutable accountId;
    uint256 public immutable executionId;

    error IdentityMismatch();
    error InvalidContext();
    error EvaluationFailed();

    constructor(uint256 market, uint256 account, uint256 execution) {
        if (block.chainid != 196 && block.chainid != 31337) revert IdentityMismatch();
        checkRuntime();
        if (!IWitnessFactory(FACTORY).isCPU(CPU) || IWitnessFactory(FACTORY).cpuAt(410) != CPU) revert IdentityMismatch();
        _checkProgram(market, 63, 0xe845d0cb6d0e0c86faca013143995f6a0c9d6a1dbb0772a6176fe0ee977e6c09);
        _checkProgram(account, 87, 0x7dbd1ad5e86acbf5796e7ed7aacbcb724ae35b69ee5742c8efae1744d20a6818);
        _checkProgram(execution, 59, 0x898674f49c1caa2e3196f31ce7afe18fa839d6260d5f75ebc4cd2248d266b30b);
        marketId = market;
        accountId = account;
        executionId = execution;
    }

    function checkRuntime() public view {
        if (CPU.codehash != 0x8c799a18cd8e0d5f5f3c0cec4fbc145e2daf79f70c2b131c09d0f380921db545
            || BEACON.codehash != 0xc7cc9854e1465f48d6d8d6d220c04efa6509939832930be4b04ee7fe86575362
            || IMPLEMENTATION.codehash != 0x7a15c353205e5245f40f5f5524542a982a4bb3b9a28476e4f10845163f941b30
            || IWitnessBeacon(BEACON).implementation() != IMPLEMENTATION) revert IdentityMismatch();
    }

    function _checkProgram(uint256 id, uint32 gates, bytes32 hash) private view {
        (uint32 inputs, uint32 outputs, uint32 state, uint32 count) = IWitnessCPU(CPU).circuitInfo(id);
        if (inputs != 20 || outputs != 1 || state != 0 || count != gates
            || keccak256(IWitnessCPU(CPU).netlist(id)) != hash) revert IdentityMismatch();
    }

    /// @param kind 0 MARKET, 1 ACCOUNT, 2 EXECUTION. Input pins are LSB first.
    function evaluate(uint8 kind, bytes3 context) external view returns (bool) {
        if (kind > 2 || uint8(context[2]) > 15) revert InvalidContext();
        checkRuntime();
        uint256 id = kind == 0 ? marketId : kind == 1 ? accountId : executionId;
        bytes memory callData = abi.encodeCall(IWitnessCPU.eval, (id, abi.encodePacked(context)));
        address cpu = CPU;
        bool valid;
        uint256 word;
        assembly ("memory-safe") {
            let p := mload(0x40)
            let ok := staticcall(1500000, cpu, add(callData, 32), mload(callData), p, 96)
            valid := and(and(ok, eq(returndatasize(), 96)), and(eq(mload(p), 32), eq(mload(add(p, 32)), 1)))
            word := mload(add(p, 64))
        }
        if (!valid || (word != 0 && word != 1 << 248)) revert EvaluationFailed();
        return word != 0;
    }
}
