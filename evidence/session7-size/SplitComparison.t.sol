// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {SplitVaultFactory} from "../../src/size7/SplitVaultFactory.sol";

interface VMSize {
    function getCode(string calldata artifact) external view returns (bytes memory);
    function prank(address sender) external;
    function expectRevert(bytes calldata reason) external;
}

interface SizeAccount {
    function owner() external view returns (address);
    function policyId() external view returns (bytes32);
    function operatorCount() external view returns (uint256);
    function vaultPosition() external view returns (uint256,uint256,uint256,uint256);
}

contract SplitComparisonTest {
    VMSize private constant vm = VMSize(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant liveAccount = 0xa167627CD59445dD9792d0F3d8D465C2bC41E574;
    address private constant lending = 0xdAd2bbF5ce7Bc43A932C78B5bCd5e0d284348101;
    address private constant swap = 0xf2e6D955158FE77252713d982F9d376F467E7cD3;
    address private constant execution = 0xc72a18670C185f6a5e39dfbf10C27f025aa96D9c;
    address private constant vault = 0xdA483ece7dca16aB9B6d814b184f9ca410B8fC74;

    function testSameRuntimeFreshStorageAndUniqueRegistration() external {
        bytes memory init = bytes.concat(vm.getCode("SplitVaultFactory.sol:SplitVaultFactory"), abi.encode(lending, swap, execution, vault));
        address deployed;
        assembly ("memory-safe") { deployed := create(0, add(init, 32), mload(init)) }
        require(deployed != address(0), "factory creation");
        SplitVaultFactory factory = SplitVaultFactory(deployed);
        address owner = SizeAccount(liveAccount).owner();
        bytes32 policy = SizeAccount(liveAccount).policyId();
        vm.prank(owner);
        address fresh = factory.createAccount(policy);
        require(fresh != liveAccount && fresh.codehash == liveAccount.codehash, "published account runtime");
        require(factory.accountOf(owner) == fresh && SizeAccount(fresh).owner() == owner, "registration");
        require(SizeAccount(fresh).policyId() == policy && SizeAccount(fresh).operatorCount() == 0, "policy or grants");
        (uint256 shares,,,) = SizeAccount(fresh).vaultPosition();
        (uint256 existingShares,,,) = SizeAccount(liveAccount).vaultPosition();
        require(shares == 0 && existingShares == 4000000, "fresh storage and original position");
        vm.expectRevert(abi.encodeWithSelector(SplitVaultFactory.AccountAlreadyExists.selector, fresh));
        vm.prank(owner);
        factory.createAccount(policy);
    }
}
