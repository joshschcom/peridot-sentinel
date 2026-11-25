// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPolicyProcessor} from "./PolicyRegistry.sol";

import {TestProfile} from "../markets/TestProfile.sol";

/// @notice Development fixture implementing a restricted, stateless NAND interpreter. No sponsor deployment or NFT.
contract DevelopmentReferenceProcessor is TestProfile, IPolicyProcessor {
    mapping(uint256 => bytes) private programs;
    uint256 public nextId = 1;

    event ReferenceCircuitAdded(uint256 indexed id, bytes32 netlistHash);

    function addReferenceCircuit(bytes calldata program) external returns (uint256 id) {
        require(program.length > 0 && program.length <= 256 * 7 && program.length % 7 == 0, "gate count");
        for (uint256 i; i < program.length; i += 7) {
            uint256 nextWire = 22 + i / 7;
            require(program[i] == 0 && uint24(bytes3(program[i+1:i+4])) < nextWire
                && uint24(bytes3(program[i+4:i+7])) < nextWire, "invalid NAND");
        }
        id = nextId++;
        programs[id] = program;
        emit ReferenceCircuitAdded(id, keccak256(program));
    }

    function circuitInfo(uint256 id) external view returns (uint32, uint32, uint32, uint32) {
        require(programs[id].length != 0, "unknown reference circuit");
        return (20, 1, 0, uint32(programs[id].length / 7));
    }

    function netlist(uint256 id) external view returns (bytes memory) {
        require(programs[id].length != 0, "unknown reference circuit");
        return programs[id];
    }

    function eval(uint256 id, bytes calldata inputs) external view returns (bytes memory) {
        require(inputs.length == 3 && uint8(inputs[2]) < 16, "invalid context");
        bytes memory program = programs[id];
        require(program.length > 0, "unknown reference circuit");
        uint256 gates = program.length / 7;
        bool[] memory wires = new bool[](22 + gates);
        wires[1] = true;
        for (uint256 i; i < 20; ++i) {
            wires[i + 2] = (uint8(inputs[i / 8]) >> (i % 8)) & 1 != 0;
        }
        for (uint256 i; i < gates; ++i) {
            uint256 a;
            uint256 b;
            assembly ("memory-safe") {
                let p := add(add(program, 33), mul(i, 7))
                a := shr(232, mload(p))
                b := shr(232, mload(add(p, 3)))
            }
            wires[22 + i] = !(wires[a] && wires[b]);
        }
        return abi.encodePacked(wires[wires.length - 1] ? bytes1(0x01) : bytes1(0));
    }
}
