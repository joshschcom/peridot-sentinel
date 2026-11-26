// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {VaultSentinelAccountV2} from "../../src/vault/VaultSentinelAccountV2.sol";
import {VaultSentinelAccountFactoryV2} from "../../src/vault/VaultSentinelAccountFactoryV2.sol";
import {TestnetSavingsVault} from "../../src/vault/TestnetSavingsVault.sol";
import {ISavingsVault, SingleVaultAdapter} from "../../src/vault/SingleVaultAdapter.sol";
import {OtherVenueFixture} from "../vault/SingleVault.t.sol";

interface ReviewVm {
    function envOr(string calldata name, bool fallbackValue) external view returns (bool);
    function getCode(string calldata path) external view returns (bytes memory);
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
    function expectRevert() external;
    function expectRevert(bytes4 selector) external;
    function mockCall(address target, bytes calldata data, bytes calldata result) external;
    function clearMockedCalls() external;
}

/// @dev Test-only token observes one fixed zero-size call during a vault transfer.
contract ReviewAsset is ERC20 {
    bool public observe;
    bytes4 public nestedResult;
    uint256 public observedAllowance;

    constructor() ERC20("Review asset", "TEST") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address receiver, uint256 amount) external {
        _mint(receiver, amount);
    }

    function enableObserver() external {
        observe = true;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        observedAllowance = allowance(from, msg.sender);
        if (observe) {
            try VaultSentinelAccountV2(from).depositToVault(0, 0, 0) {
                revert("nested operation unexpectedly accepted");
            } catch (bytes memory data) {
                nestedResult = bytes4(data);
            }
        }
        return super.transferFrom(from, to, amount);
    }
}

abstract contract ReviewFixture {
    ReviewVm internal constant vm = ReviewVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 internal constant INITIAL = 1_000_000e6;
    ReviewAsset internal asset;
    TestnetSavingsVault internal vault;
    SingleVaultAdapter internal binding;
    VaultSentinelAccountV2 internal account;

    function _setup(address owner) internal {
        asset = new ReviewAsset();
        ReviewAsset other = new ReviewAsset();
        vault = new TestnetSavingsVault(asset);
        binding = new SingleVaultAdapter(ISavingsVault(address(vault)), asset);
        OtherVenueFixture unrelated = new OtherVenueFixture(address(asset), address(other));
        bytes memory init = bytes.concat(
            vm.getCode("out/VaultSentinelAccountFactoryV2.sol/VaultSentinelAccountFactoryV2.json"),
            abi.encode(unrelated, unrelated, unrelated, binding)
        );
        VaultSentinelAccountFactoryV2 factory;
        assembly ("memory-safe") { factory := create(0, add(init, 32), mload(init)) }
        require(address(factory).code.length > 0);
        vm.prank(owner);
        account = VaultSentinelAccountV2(factory.createAccount(bytes32(uint256(1))));
        vm.prank(owner);
        account.setVaultDepositLimits(INITIAL, 1e18);
        asset.mint(address(account), INITIAL);
    }
}
