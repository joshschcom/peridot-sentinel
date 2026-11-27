// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Append-only directory of publications for the X Layer testnet strategy profile.
/// @dev Publishers supply the JSON and index labels. Readers must verify them with the strategy SDK.
contract StrategyRegistry {
    uint256 private constant TARGET_CHAIN_ID = 1952;
    uint256 private constant MAX_JSON_BYTES = 8192;

    struct Publication {
        bytes32 adapterVersion;
        bytes32 policyKey;
        bytes32 contentHash;
        bytes canonicalJson;
    }

    mapping(address creator => mapping(bytes32 seriesId => uint32)) public latestVersion;
    mapping(address creator => mapping(bytes32 seriesId => mapping(uint32 version => Publication))) private
        publications;

    error UnsupportedChain(uint256 chainId);
    error EmptyIdentity();
    error InvalidJsonLength(uint256 length);
    error UnexpectedVersion(uint32 latestVersion, uint32 requestedVersion);
    error MissingVersion();

    event StrategyPublished(
        uint256 indexed targetChainId,
        bytes32 indexed adapterVersion,
        bytes32 indexed policyKey,
        address creator,
        bytes32 seriesId,
        uint32 version,
        bytes32 contentHash
    );

    constructor() {
        if (block.chainid != TARGET_CHAIN_ID && block.chainid != 31337) revert UnsupportedChain(block.chainid);
    }

    /// @param expectedVersion One greater than the latest version in the sender's series.
    function publish(
        bytes32 seriesId,
        uint32 expectedVersion,
        uint256 targetChainId,
        bytes32 adapterVersion,
        bytes32 policyKey,
        bytes calldata canonicalJson
    ) external {
        if (targetChainId != TARGET_CHAIN_ID) revert UnsupportedChain(targetChainId);
        if (seriesId == 0 || adapterVersion == 0 || policyKey == 0) revert EmptyIdentity();
        if (canonicalJson.length == 0 || canonicalJson.length > MAX_JSON_BYTES) {
            revert InvalidJsonLength(canonicalJson.length);
        }

        uint32 latest = latestVersion[msg.sender][seriesId];
        if (uint256(latest) + 1 != expectedVersion) revert UnexpectedVersion(latest, expectedVersion);

        bytes32 contentHash = keccak256(canonicalJson);
        publications[msg.sender][seriesId][expectedVersion] =
            Publication(adapterVersion, policyKey, contentHash, canonicalJson);
        latestVersion[msg.sender][seriesId] = expectedVersion;
        emit StrategyPublished(
            targetChainId, adapterVersion, policyKey, msg.sender, seriesId, expectedVersion, contentHash
        );
    }

    function readVersion(address creator, bytes32 seriesId, uint32 version)
        external
        view
        returns (
            uint256 targetChainId,
            bytes32 adapterVersion,
            bytes32 policyKey,
            bytes32 contentHash,
            bytes memory canonicalJson
        )
    {
        Publication storage publication = publications[creator][seriesId][version];
        if (publication.canonicalJson.length == 0) revert MissingVersion();
        return (
            TARGET_CHAIN_ID,
            publication.adapterVersion,
            publication.policyKey,
            publication.contentHash,
            publication.canonicalJson
        );
    }
}
