// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {StrategyRegistry} from "../../src/registry9/StrategyRegistry.sol";

interface RegistryVm {
    function chainId(uint256) external;
    function prank(address) external;
    function deal(address, uint256) external;
    function expectRevert(bytes calldata) external;
    function expectRevert(bytes4) external;
    function expectEmit(bool, bool, bool, bool, address) external;
    function assume(bool) external;
}

contract StrategyRegistryTest {
    RegistryVm private constant vm = RegistryVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 private constant SERIES = keccak256("series");
    bytes32 private constant ADAPTER = keccak256("adapter/1");
    bytes32 private constant POLICY = keccak256("policy/1");
    address private constant OTHER_CREATOR = address(0x1234);
    StrategyRegistry private registry;

    function setUp() external {
        vm.chainId(31337);
        registry = new StrategyRegistry();
    }

    function testEmitsDiscoveryTopicsAndImmutableKey() external {
        bytes memory json = bytes('{"example":"fixture"}');
        vm.expectEmit(true, true, true, true, address(registry));
        emit StrategyRegistry.StrategyPublished(1952, ADAPTER, POLICY, OTHER_CREATOR, SERIES, 1, keccak256(json));
        vm.prank(OTHER_CREATOR);
        registry.publish(SERIES, 1, 1952, ADAPTER, POLICY, json);
        require(registry.latestVersion(OTHER_CREATOR, SERIES) == 1, "creator series");
        require(registry.latestVersion(address(this), SERIES) == 0, "other namespace");
    }

    function testFuzzExactBytesAndHash(bytes calldata input) external {
        vm.assume(input.length > 0 && input.length <= 8192);
        registry.publish(SERIES, 1, 1952, ADAPTER, POLICY, input);
        _assertPublication(address(this), 1, ADAPTER, POLICY, input);
    }

    function testFuzzNewVersionsAndOtherCreatorsCannotAlterPriorRecord(bytes32 first, bytes32 second, bytes32 third)
        external
    {
        bytes memory original = abi.encodePacked(first);
        bytes memory update = abi.encodePacked(second);
        bytes memory other = abi.encodePacked(third);
        registry.publish(SERIES, 1, 1952, ADAPTER, POLICY, original);

        vm.prank(OTHER_CREATOR);
        registry.publish(SERIES, 1, 1952, POLICY, ADAPTER, other);
        registry.publish(SERIES, 2, 1952, POLICY, ADAPTER, update);
        vm.expectRevert(abi.encodeWithSelector(StrategyRegistry.UnexpectedVersion.selector, uint32(2), uint32(1)));
        registry.publish(SERIES, 1, 1952, POLICY, ADAPTER, other);

        _assertPublication(address(this), 1, ADAPTER, POLICY, original);
        _assertPublication(address(this), 2, POLICY, ADAPTER, update);
        _assertPublication(OTHER_CREATOR, 1, POLICY, ADAPTER, other);
        require(registry.latestVersion(address(this), SERIES) == 2, "sender series");
        require(registry.latestVersion(OTHER_CREATOR, SERIES) == 1, "independent series");
    }

    function testRejectsMissingAndStaleVersions() external {
        vm.expectRevert(StrategyRegistry.MissingVersion.selector);
        registry.readVersion(address(this), SERIES, 0);
        vm.expectRevert(abi.encodeWithSelector(StrategyRegistry.UnexpectedVersion.selector, uint32(0), uint32(0)));
        registry.publish(SERIES, 0, 1952, ADAPTER, POLICY, "first");
        vm.expectRevert(abi.encodeWithSelector(StrategyRegistry.UnexpectedVersion.selector, uint32(0), uint32(2)));
        registry.publish(SERIES, 2, 1952, ADAPTER, POLICY, "skip");
        registry.publish(SERIES, 1, 1952, ADAPTER, POLICY, "first");
        vm.expectRevert(abi.encodeWithSelector(StrategyRegistry.UnexpectedVersion.selector, uint32(1), uint32(1)));
        registry.publish(SERIES, 1, 1952, ADAPTER, POLICY, "racing");
        vm.expectRevert(StrategyRegistry.MissingVersion.selector);
        registry.readVersion(address(this), SERIES, 2);
        vm.expectRevert(StrategyRegistry.MissingVersion.selector);
        registry.readVersion(OTHER_CREATOR, SERIES, 1);
    }

    function testRejectsEmptyLabelsAndUnsupportedTarget() external {
        vm.expectRevert(StrategyRegistry.EmptyIdentity.selector);
        registry.publish(0, 1, 1952, ADAPTER, POLICY, "x");
        vm.expectRevert(StrategyRegistry.EmptyIdentity.selector);
        registry.publish(SERIES, 1, 1952, 0, POLICY, "x");
        vm.expectRevert(StrategyRegistry.EmptyIdentity.selector);
        registry.publish(SERIES, 1, 1952, ADAPTER, 0, "x");
        vm.expectRevert(abi.encodeWithSelector(StrategyRegistry.UnsupportedChain.selector, uint256(31337)));
        registry.publish(SERIES, 1, 31337, ADAPTER, POLICY, "x");
        require(registry.latestVersion(address(this), SERIES) == 0, "invalid record stored");
    }

    function testRejectsZeroAndOversizeBytesAndReadsMaxLength() external {
        vm.expectRevert(abi.encodeWithSelector(StrategyRegistry.InvalidJsonLength.selector, uint256(0)));
        registry.publish(SERIES, 1, 1952, ADAPTER, POLICY, "");
        vm.expectRevert(abi.encodeWithSelector(StrategyRegistry.InvalidJsonLength.selector, uint256(8193)));
        registry.publish(SERIES, 1, 1952, ADAPTER, POLICY, new bytes(8193));
        bytes memory full = new bytes(8192);
        full[0] = 0x61;
        full[8191] = 0x7a;
        registry.publish(SERIES, 1, 1952, ADAPTER, POLICY, full);
        _assertPublication(address(this), 1, ADAPTER, POLICY, full);
    }

    function testRegistryCannotReceivePaymentOrExecuteArbitraryCalls() external {
        vm.deal(address(this), 1 wei);
        bytes memory publishData = abi.encodeCall(registry.publish, (SERIES, 1, 1952, ADAPTER, POLICY, bytes("x")));
        (bool paid,) = address(registry).call{value: 1 wei}(publishData);
        (bool plain,) = address(registry).call{value: 1 wei}("");
        (bool unknown,) = address(registry).call(hex"deadbeef");
        require(!paid && !plain && !unknown, "unexpected call accepted");
        require(
            address(registry).balance == 0 && registry.latestVersion(address(this), SERIES) == 0, "paid publication"
        );
    }

    function testConstructorOnlyOnRehearsalOrTestnet() external {
        vm.chainId(196);
        vm.expectRevert(abi.encodeWithSelector(StrategyRegistry.UnsupportedChain.selector, uint256(196)));
        new StrategyRegistry();
        vm.chainId(1952);
        StrategyRegistry testnet = new StrategyRegistry();
        require(address(testnet).code.length > 0, "missing registry");
    }

    function _assertPublication(address creator, uint32 version, bytes32 adapter, bytes32 policy, bytes memory expected)
        private
        view
    {
        (uint256 target, bytes32 actualAdapter, bytes32 actualPolicy, bytes32 hash, bytes memory raw) =
            registry.readVersion(creator, SERIES, version);
        require(target == 1952 && actualAdapter == adapter && actualPolicy == policy, "index labels");
        require(hash == keccak256(expected) && keccak256(raw) == hash && raw.length == expected.length, "content");
    }
}
