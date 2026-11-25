// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {TestProfile} from "../markets/TestProfile.sol";

interface IPolicyProcessor {
    function circuitInfo(uint256 id) external view returns (uint32, uint32, uint32, uint32);
    function netlist(uint256 id) external view returns (bytes memory);
    function eval(uint256 id, bytes calldata inputs) external view returns (bytes memory);
}

contract PolicyRegistry is TestProfile {
    struct Entry {
        uint256 chainId;
        address processor;
        uint256 circuitId;
        bytes32 processorCodeHash;
        uint8 kind;
        uint8 schemaVersion;
        uint8 templateVersion;
        uint32 gateCount;
        bytes32 netlistHash;
        bytes32 configHash;
        bytes32 metadataHash;
        address publisher;
    }

    uint32 public constant MAX_GATES = 256;
    address public immutable owner;
    mapping(address => bytes32) public trustedCodeHash;
    mapping(bytes32 => Entry) private entries;

    error Unauthorized();
    error InvalidProcessor();
    error InvalidCircuit();
    error DuplicatePolicy(bytes32 id);
    error UnavailablePolicy(bytes32 id);

    event ProcessorTrustSet(address indexed processor, bytes32 codeHash);
    event PolicyRegistered(bytes32 indexed policyId, address indexed processor, uint256 indexed circuitId, uint8 kind);

    constructor(address registrar) {
        if (registrar == address(0)) revert Unauthorized();
        owner = registrar;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    function setProcessorTrust(address processor, bool trusted) external onlyOwner {
        if (trusted && processor.code.length == 0) revert InvalidProcessor();
        bytes32 hash = trusted ? processor.codehash : bytes32(0);
        trustedCodeHash[processor] = hash;
        emit ProcessorTrustSet(processor, hash);
    }

    /// @notice The registrar attests that configHash compiles to expectedNetlistHash with the selected template.
    function register(address processor, uint256 circuitId, uint8 kind, bytes32 expectedNetlistHash,
        bytes32 configHash, bytes32 metadataHash) external onlyOwner returns (bytes32 id)
    {
        bytes32 codeHash = trustedCodeHash[processor];
        if (codeHash == 0 || codeHash != processor.codehash) revert InvalidProcessor();
        if (kind > 1 || configHash == 0) revert InvalidCircuit();
        IPolicyProcessor cpu = IPolicyProcessor(processor);
        (uint32 nIn, uint32 nOut, uint32 stateBits, uint32 gates) = cpu.circuitInfo(circuitId);
        if (nIn != 20 || nOut != 1 || stateBits != 0 || gates == 0 || gates > MAX_GATES) revert InvalidCircuit();
        // Only the authorized registrar can invoke this read, on an explicitly trusted CPU.
        bytes memory net = cpu.netlist(circuitId);
        if (net.length != uint256(gates) * 7 || keccak256(net) != expectedNetlistHash) revert InvalidCircuit();
        for (uint256 i; i < gates; ++i) {
            uint256 offset = i * 7;
            if (net[offset] != 0 || _wire(net, offset + 1) >= 22 + i || _wire(net, offset + 4) >= 22 + i) {
                revert InvalidCircuit();
            }
        }
        id = keccak256(abi.encode(block.chainid, address(this), processor, circuitId, kind,
            uint8(1), uint8(0), expectedNetlistHash, configHash));
        if (entries[id].processor != address(0)) revert DuplicatePolicy(id);
        entries[id] = Entry(block.chainid, processor, circuitId, codeHash, kind, 1, 0,
            gates, expectedNetlistHash, configHash, metadataHash, msg.sender);
        emit PolicyRegistered(id, processor, circuitId, kind);
    }

    function _wire(bytes memory net, uint256 offset) private pure returns (uint24 wire) {
        assembly ("memory-safe") { wire := shr(232, mload(add(add(net, 32), offset))) }
    }

    function getPolicy(bytes32 id) external view returns (Entry memory) {
        return entries[id];
    }

    function requirePolicy(bytes32 id, uint8 kind) public view returns (address processor, uint256 circuitId) {
        Entry storage entry = entries[id];
        processor = entry.processor;
        if (processor == address(0) || entry.kind != kind || entry.chainId != block.chainid
            || trustedCodeHash[processor] != entry.processorCodeHash || processor.codehash != entry.processorCodeHash) {
            revert UnavailablePolicy(id);
        }
        circuitId = entry.circuitId;
    }
}
