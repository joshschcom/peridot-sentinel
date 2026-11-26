# Sentinel Connect evidence

The official external MCP client negotiated stdio with the Sentinel server and discovered twelve tools. One tool can submit a transaction. The remaining tools read, quote, simulate or create local proposals. [Tool catalogue](tools.json)

Seven keyless public calls returned verified data at X Layer testnet blocks 47,241,787 through 47,241,845. At the final block the real account simulated a 2,000,000-raw-unit auto-repayment under mask 8, equivalent to 2 mock dollars. These were RPC reads. [Account, exposure, rates, policies, grant and simulation](stdio-read.json)

The configured operator's simulated one-mock-dollar borrow reverted with `OperatorNotAuthorized(operator,2)` at block 47,242,062. The archive contains the actual revert bytes and block hash. The OKX quote tool separately returned a blocked result with a null quote because external credentials were unavailable for this capture. [Borrow rejection](borrow-simulation.json) · [Quote result](quote-read.json)

As an independent verification fixture, the receipt verifier replayed the earlier keeper repayment, matching the Sentinel and pToken events, caller and transaction input, and observing the debt change from 80,000,000 to 60,000,016 raw units. This transaction predates MCP. [Prior keeper receipt replay](previous-keeper-receipt-verification.json)

The authorized seven-step command writes `flagship-1952.json` in this directory as it progresses. Its receipt, event and final grant are the evidence for any Connect-submitted transaction. [Run the external client](../../services/mcp/README.md)

The external stdio client also called the write tool with execution disabled. The server returned `EXECUTION_DISABLED` and the client exited 1. [Disabled execution result](disabled-execution.json)
