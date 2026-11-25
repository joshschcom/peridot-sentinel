// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @dev Read-only Solidity probe for the pinned X Layer fork evidence.
interface IProcessorProbeTarget {
    function eval(uint256 id, bytes calldata inputs) external view returns (bytes memory);
}

contract ProcessorProbe {
    function evaluate(address processor, uint256 circuitId, bytes calldata context)
        external view returns (bool allow, uint256 callGas)
    {
        require(context.length == 3 && uint8(context[2]) < 16, "invalid v1 input");
        uint256 beforeCall = gasleft();
        bytes memory result = IProcessorProbeTarget(processor).eval(circuitId, context);
        callGas = beforeCall - gasleft();
        require(result.length == 1 && uint8(result[0]) <= 1, "invalid v1 output");
        return (result[0] == 0x01, callGas);
    }
}
