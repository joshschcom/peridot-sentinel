// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface NativeVm {
    function envAddress(string calldata) external returns (address);
    function mockCall(address, bytes calldata, bytes calldata) external;
    function mockCallRevert(address, bytes calldata, bytes calldata) external;
    function clearMockedCalls() external;
    function prank(address) external;
    function expectRevert(bytes calldata) external;
}
interface INativeTestAccount {
    function owner() external view returns (address);
    function collateralAsset() external view returns (address);
    function debtMarket() external view returns (address);
    function controller() external view returns (address);
    function policyId() external view returns (bytes32);
    function borrow(uint256) external;
    function swapExactIn(address, uint256, uint256, uint64) external returns(uint256);
}
interface INativeTestBook {
    function borrow(uint256) external returns (uint256);
    function borrowBalanceStored(address) external view returns(uint256);
}
interface INativeTestController {
    function policyId() external view returns(bytes32);
}

/// @notice Executed by run.mjs against the actual fork account via forge script, without broadcast.
/// VM mocks intercept only eval() inside this isolated test. The genuine dependency code hashes still match.
contract NativeResponseProof {
    NativeVm private constant vm = NativeVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant CPU = 0x423446EEFAa885B804C7bD9B0bdD130cE2Ee00B5;
    bytes4 private constant EVAL = bytes4(keccak256("eval(uint256,bytes)"));

    function run() external {
        require(block.chainid == 31337);
        INativeTestAccount account = INativeTestAccount(vm.envAddress("NATIVE7_FORK_ACCOUNT"));
        address owner = account.owner();
        INativeTestBook book = INativeTestBook(account.debtMarket());
        bytes32 expectedHash = CPU.codehash;
        bytes memory accountError = abi.encodeWithSignature("PolicyEvaluationFailed(bytes32)",account.policyId());
        bytes memory marketError = abi.encodeWithSignature("PolicyEvaluationFailed(bytes32)",INativeTestController(account.controller()).policyId());
        address col = account.collateralAsset();
        uint256 accountDebt = book.borrowBalanceStored(address(account));
        uint256 directDebt = book.borrowBalanceStored(owner);
        for(uint256 i; i < 4; ++i) {
            if(i == 0) vm.mockCallRevert(CPU,abi.encodePacked(EVAL),bytes(""));
            else if(i == 1) vm.mockCall(CPU,abi.encodePacked(EVAL),hex"01");
            else if(i == 2) vm.mockCall(CPU,abi.encodePacked(EVAL),abi.encode(hex"02"));
            else vm.mockCall(CPU,abi.encodePacked(EVAL),bytes.concat(abi.encode(hex"01"),abi.encode(uint256(0))));
            vm.expectRevert(accountError);
            vm.prank(owner);
            account.borrow(1e6);
            vm.expectRevert(marketError);
            vm.prank(owner);
            book.borrow(1e6);
            vm.expectRevert(abi.encodeWithSignature("ExecutionEvaluationFailed()"));
            vm.prank(owner);
            account.swapExactIn(col,1e18,990000,uint64(block.timestamp + 300));
            require(CPU.codehash == expectedHash && book.borrowBalanceStored(address(account)) == accountDebt
                && book.borrowBalanceStored(owner) == directDebt);
            vm.clearMockedCalls();
        }
    }
}
