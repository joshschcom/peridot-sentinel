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
    // Reproduce with packages/circuit-sdk/scripts/studio-tree.mjs --check.
    bytes32 public constant MARKET_TEMPLATE_ROOT = 0xec7861345eb0b7eb7e7c96d5ceec277180b86ef226c2c8c064e18576879e0a60;
    mapping(address processor => mapping(bytes32 configHash => bytes32 policyId)) public marketTemplatePolicy;
    address public immutable owner;
    mapping(address => bytes32) public trustedCodeHash;
    mapping(bytes32 => Entry) private entries;

    error Unauthorized();
    error InvalidProcessor();
    error InvalidCircuit();
    error InvalidTemplateProof();
    error DuplicatePolicy(bytes32 id);
    error UnavailablePolicy(bytes32 id);

    event MarketTemplateRegistered(bytes32 indexed policyId, address indexed processor, uint16 maxLtvBps,
        bool requireCashReserve, bytes32 configHash);
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
        return _register(processor, circuitId, kind, expectedNetlistHash, configHash, metadataHash);
    }

    /// @notice Anyone may publish the exact compiler output for this version's market template.
    /// @dev The leaf index is maxLtvBps * 2 + reserve; SDK siblings run from leaf to root.
    function registerMarketTemplate(address processor, uint256 circuitId, uint16 maxLtvBps, bool requireCashReserve,
        bytes32 expectedNetlistHash, bytes32 configHash, bytes32[] calldata proof) external returns (bytes32 id)
    {
        if (maxLtvBps > 10000 || proof.length != 15) revert InvalidTemplateProof();
        uint256 index = uint256(maxLtvBps) * 2 + (requireCashReserve ? 1 : 0);
        bytes32 node = keccak256(abi.encodePacked(maxLtvBps, requireCashReserve, configHash, expectedNetlistHash));
        for (uint256 i; i < 15; ++i) {
            node = index & 1 == 0
                ? keccak256(abi.encodePacked(node, proof[i]))
                : keccak256(abi.encodePacked(proof[i], node));
            index >>= 1;
        }
        if (node != MARKET_TEMPLATE_ROOT) revert InvalidTemplateProof();

        // Multiple creators may choose the same rule concurrently. Reuse the first verified circuit,
        // including its real processor/circuit ID, and check that its processor is still trusted.
        id = marketTemplatePolicy[processor][configHash];
        if (id != bytes32(0)) {
            requirePolicy(id, 0);
            return id;
        }
        id = _policyId(processor, circuitId, 0, expectedNetlistHash, configHash);
        if (entries[id].processor == address(0)) {
            _register(processor, circuitId, 0, expectedNetlistHash, configHash, bytes32(0));
        } else {
            // A registrar may have published this exact, immutable entry through register().
            requirePolicy(id, 0);
        }
        marketTemplatePolicy[processor][configHash] = id;
        emit MarketTemplateRegistered(id, processor, maxLtvBps, requireCashReserve, configHash);
    }

    function _policyId(address processor, uint256 circuitId, uint8 kind, bytes32 netlistHash, bytes32 configHash)
        private view returns (bytes32)
    {
        return keccak256(abi.encode(block.chainid, address(this), processor, circuitId, kind,
            uint8(1), uint8(0), netlistHash, configHash));
    }

    function _register(address processor, uint256 circuitId, uint8 kind, bytes32 expectedNetlistHash,
        bytes32 configHash, bytes32 metadataHash) private returns (bytes32 id)
    {
        bytes32 codeHash = trustedCodeHash[processor];
        if (codeHash == 0 || codeHash != processor.codehash) revert InvalidProcessor();
        if (kind > 1 || configHash == 0) revert InvalidCircuit();
        IPolicyProcessor cpu = IPolicyProcessor(processor);
        (uint32 nIn, uint32 nOut, uint32 stateBits, uint32 gates) = cpu.circuitInfo(circuitId);
        if (nIn != 20 || nOut != 1 || stateBits != 0 || gates == 0 || gates > MAX_GATES) revert InvalidCircuit();
        // Trust and dimension checks precede reading the processor's program.
        bytes memory net = cpu.netlist(circuitId);
        if (net.length != uint256(gates) * 7 || keccak256(net) != expectedNetlistHash) revert InvalidCircuit();
        for (uint256 i; i < gates; ++i) {
            uint256 offset = i * 7;
            if (net[offset] != 0 || _wire(net, offset + 1) >= 22 + i || _wire(net, offset + 4) >= 22 + i) {
                revert InvalidCircuit();
            }
        }
        id = _policyId(processor, circuitId, kind, expectedNetlistHash, configHash);
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
