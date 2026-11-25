// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PolicyRegistry} from "../../src/policies/PolicyRegistry.sol";
import {DevelopmentReferenceProcessor} from "../../src/policies/DevelopmentReferenceProcessor.sol";
import {TapeOutPolicyAdapter} from "../../src/policies/TapeOutPolicyAdapter.sol";
import {StudioVector as V} from "./StudioVector.sol";

interface StudioVm {
    function prank(address) external;
    function expectRevert(bytes4) external;
    function expectRevert(bytes calldata) external;
}

contract StudioTest {
    StudioVm private constant vm = StudioVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant CREATOR = address(123);
    PolicyRegistry private registry;
    DevelopmentReferenceProcessor private cpu;
    uint256 private circuit;

    function setUp() external {
        registry = new PolicyRegistry(address(this));
        cpu = new DevelopmentReferenceProcessor();
        registry.setProcessorTrust(address(cpu), true);
        circuit = cpu.addReferenceCircuit(V.PROGRAM);
    }

    function publish(PolicyRegistry r, DevelopmentReferenceProcessor p, uint256 which) private returns (bytes32) {
        vm.prank(CREATOR);
        return r.registerMarketTemplate(address(p), which, V.BPS, true, V.NET, V.CONFIG, V.proof());
    }

    function testCreatorPublishesAndProcessorEnforcesBoundary() external {
        bytes32 id = publish(registry, cpu, circuit);
        PolicyRegistry.Entry memory e = registry.getPolicy(id);
        require(e.kind == 0 && e.publisher == CREATOR && e.configHash == V.CONFIG && e.netlistHash == V.NET);
        require(registry.marketTemplatePolicy(address(cpu), V.CONFIG) == id);
        TapeOutPolicyAdapter adapter = new TapeOutPolicyAdapter(registry);
        adapter.enforce(id, 0, 2, true, V.BPS, true);
        vm.expectRevert(abi.encodeWithSelector(TapeOutPolicyAdapter.MarketPolicyRejected.selector, id, uint8(1)));
        adapter.enforce(id, 0, 2, true, V.BPS + 1, true);
    }

    function testCreatorCannotUseRegistrarOrAccountPermissions() external {
        vm.prank(CREATOR);
        vm.expectRevert(PolicyRegistry.Unauthorized.selector);
        registry.register(address(cpu), circuit, 1, V.NET, V.CONFIG, 0);
        vm.prank(CREATOR);
        vm.expectRevert(PolicyRegistry.Unauthorized.selector);
        registry.setProcessorTrust(address(cpu), false);
        bytes32 id = publish(registry, cpu, circuit);
        vm.expectRevert(abi.encodeWithSelector(PolicyRegistry.UnavailablePolicy.selector, id));
        registry.requirePolicy(id, 1);
    }

    function testProofBindsLiteralOptionsAndBothHashes() external {
        bytes32[] memory proof = V.proof();
        vm.expectRevert(PolicyRegistry.InvalidTemplateProof.selector);
        registry.registerMarketTemplate(address(cpu), circuit, V.BPS + 1, true, V.NET, V.CONFIG, proof);
        vm.expectRevert(PolicyRegistry.InvalidTemplateProof.selector);
        registry.registerMarketTemplate(address(cpu), circuit, V.BPS, false, V.NET, V.CONFIG, proof);
        vm.expectRevert(PolicyRegistry.InvalidTemplateProof.selector);
        registry.registerMarketTemplate(address(cpu), circuit, V.BPS, true, bytes32(uint256(1)), V.CONFIG, proof);
        vm.expectRevert(PolicyRegistry.InvalidTemplateProof.selector);
        registry.registerMarketTemplate(address(cpu), circuit, V.BPS, true, V.NET, bytes32(uint256(1)), proof);
        vm.expectRevert(PolicyRegistry.InvalidTemplateProof.selector);
        registry.registerMarketTemplate(address(cpu), circuit, 10001, true, V.NET, V.CONFIG, proof);
        proof[14] = 0;
        vm.expectRevert(PolicyRegistry.InvalidTemplateProof.selector);
        registry.registerMarketTemplate(address(cpu), circuit, V.BPS, true, V.NET, V.CONFIG, proof);
    }

    function testProofAlsoRequiresTrustedProcessorAndActualMatchingNetlist() external {
        uint256 other = cpu.addReferenceCircuit(hex"00000001000001");
        vm.expectRevert(PolicyRegistry.InvalidCircuit.selector);
        registry.registerMarketTemplate(address(cpu), other, V.BPS, true, V.NET, V.CONFIG, V.proof());
        registry.setProcessorTrust(address(cpu), false);
        vm.expectRevert(PolicyRegistry.InvalidProcessor.selector);
        registry.registerMarketTemplate(address(cpu), circuit, V.BPS, true, V.NET, V.CONFIG, V.proof());
    }

    function testCanonicalReuseAcrossUsersAndIsolationAcrossRegistriesAndProcessors() external {
        bytes32 attested = registry.register(address(cpu), circuit, 0, V.NET, V.CONFIG, 0);
        require(publish(registry, cpu, circuit) == attested);
        uint256 equivalent = cpu.addReferenceCircuit(V.PROGRAM);
        require(publish(registry, cpu, equivalent) == attested);
        require(registry.getPolicy(attested).publisher == address(this));
        PolicyRegistry another = new PolicyRegistry(address(this));
        another.setProcessorTrust(address(cpu), true);
        require(publish(another, cpu, circuit) != attested);
        DevelopmentReferenceProcessor anotherCpu = new DevelopmentReferenceProcessor();
        registry.setProcessorTrust(address(anotherCpu), true);
        require(publish(registry, anotherCpu, anotherCpu.addReferenceCircuit(V.PROGRAM)) != attested);
        registry.setProcessorTrust(address(cpu), false);
        vm.expectRevert(abi.encodeWithSelector(PolicyRegistry.UnavailablePolicy.selector, attested));
        registry.registerMarketTemplate(address(cpu), equivalent, V.BPS, true, V.NET, V.CONFIG, V.proof());
    }
}
