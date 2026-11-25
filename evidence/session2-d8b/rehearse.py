"""Rehearse the three D8(b) calls on an unmodified loopback fork. Print unsigned calls and evidence."""
import json
import subprocess
import time
from pathlib import Path

PUBLIC = "https://rpc.xlayer.tech"
LOCAL = "http://127.0.0.1:19622"
PIN = 76846436
PIN_HASH = "0xb88c64f8d0b5bc53d215371a0c71b2c7c42a7258e1ec20b2d3bdab3225dccb4e"
CPU = "0x423446eefaa885b804c7bd9b0bdd130ce2ee00b5"
TRANSISTORS = "0x3896076be165d6a7ec2a70ccf6876673fe245007"
FACTORY = "0x1f09DAeFA827f02CBb40967cc91b259763760761"
BEACON = "0xf70d1ed4f62CF3780157B0b421b7E2F45bD0991C"
GAS_ORACLE = "0x420000000000000000000000000000000000000F"
MAX_FEE = 50_000_000
PRIORITY = 1


def cast(*args):
    return subprocess.check_output(["cast", *map(str, args)], text=True).strip()


def rpc(url, method, *params):
    if url != LOCAL and method not in {"eth_chainId", "eth_getBlockByNumber", "eth_getStorageAt"}:
        raise ValueError("public endpoint allows only the specified reads")
    return json.loads(cast("rpc", "-r", url, method, *params))


def view(address, method, *args):
    for attempt in range(4):
        try:
            return cast("call", "-r", LOCAL, address, method, *args)
        except subprocess.CalledProcessError:
            if attempt == 3:
                raise
            time.sleep(1)


def uint(address, method, *args):
    return int(view(address, method, *args).split()[0])


def send_only_on_fork(tx):
    tx_hash = rpc(LOCAL, "eth_sendTransaction", json.dumps(tx))
    for _ in range(100):
        receipt = rpc(LOCAL, "eth_getTransactionReceipt", tx_hash)
        if receipt:
            assert int(receipt["status"], 16) == 1, f"fork call reverted {tx_hash}"
            return receipt
        time.sleep(0.2)
    raise TimeoutError(tx_hash)


def main():
    info = rpc(LOCAL, "anvil_nodeInfo")
    assert info["environment"]["chainId"] == 31337
    assert info["forkConfig"]["forkUrl"] == PUBLIC
    assert info["forkConfig"]["forkBlockNumber"] == PIN
    assert int(info["currentBlockNumber"], 16) == PIN and info["currentBlockHash"] == PIN_HASH
    assert int(rpc(PUBLIC, "eth_chainId"), 16) == 196
    header = rpc(PUBLIC, "eth_getBlockByNumber", hex(PIN), "false")
    assert header["hash"] == PIN_HASH
    client = rpc(LOCAL, "web3_clientVersion")
    assert client.startswith("anvil/")
    sender = next(a for a in rpc(LOCAL, "eth_accounts") if cast("code", "-r", LOCAL, a) == "0x")
    assert sender.lower() != "0x8c1741a53d5fb97d74c1d105b0fbfbb4740d5d67"
    policies = json.loads(Path("packages/circuit-sdk/fixtures/policies-v1.json").read_text())["policies"]
    assert [p["gateCount"] for p in policies] == [63, 87]
    gates = sum(p["gateCount"] for p in policies)
    assert view(CPU, "transistors()(address)").lower() == TRANSISTORS
    assert view(FACTORY, "cpuAt(uint256)(address)", 410).lower() == CPU
    assert view(FACTORY, "isCPU(address)(bool)", CPU) == "true"
    price = uint(TRANSISTORS, "mintPrice()(uint256)")
    mint_fee = uint(TRANSISTORS, "protocolFee()(uint256)")
    fab_fee = uint(CPU, "TAPEOUT_FEE()(uint256)")
    assert (price, mint_fee, fab_fee) == (0, 660000000000000, 1300000000000000)
    cap = uint(TRANSISTORS, "supplyCap()(uint256)")
    minted = uint(TRANSISTORS, "minted()(uint256)")
    assert cap - minted >= gates
    nand = uint(TRANSISTORS, "NAND()(uint256)")
    assert nand == 0
    initial_balance = uint(TRANSISTORS, "balanceOf(address,uint256)(uint256)", sender, nand)
    first_id = uint(CPU, "nextId()(uint256)")
    raw_events = {}
    state = {
        "publicChainId": 196, "forkChainId": 31337, "rpc": PUBLIC, "pin": PIN,
        "pinHash": PIN_HASH, "timestampUnix": int(header["timestamp"], 16),
        "baseFeeAtPinWei": str(int(header["baseFeePerGas"], 16)), "anvil": client,
        "simulationSender": sender, "cpuIndex": 410, "cpu": CPU, "factory": FACTORY,
        "cpuName": json.loads(view(CPU, "name()(string)")), "transistors": TRANSISTORS,
        "cpuNextIdBefore": str(first_id), "componentUnitPriceWei": str(price),
        "componentBatchFeeWei": str(mint_fee), "fabricationFeeEachWei": str(fab_fee),
        "componentId": nand, "componentCap": str(cap), "mintedBefore": str(minted),
        "isSealed": view(FACTORY, "isSealed()(bool)"), "factoryOwner": view(FACTORY, "owner()(address)"),
        "beacon": BEACON, "beaconOwner": view(BEACON, "owner()(address)"),
        "cpuImplementation": view(BEACON, "implementation()(address)"),
        "factoryImplementationSlot": rpc(PUBLIC, "eth_getStorageAt", FACTORY,
            "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc", hex(PIN)),
        "processorCodeHash": cast("keccak", cast("code", "-r", LOCAL, CPU)),
    }
    proposals = []
    receipts = []
    calldata = cast("calldata", "mint(uint256,uint256)", nand, gates)
    calls = [("Mint 150 NAND", TRANSISTORS, mint_fee + price * gates, calldata, 120000)]
    for fixture, gas_limit in zip(policies, [520000, 580000]):
        assert cast("keccak", fixture["netlist"]) == fixture["netlistHash"]
        data = cast("calldata", "tapeout(bytes,uint32,uint32)", fixture["netlist"], 20, 1)
        calls.append((fixture["spec"]["kind"], CPU, fab_fee, data, gas_limit))
    for sequence, (label, to, value, data, gas_limit) in enumerate(calls):
        # Two hundred bytes conservatively covers this short EIP-1559 envelope.
        unsigned_size_bound = (len(data) - 2) // 2 + 200
        l1 = uint(GAS_ORACLE, "getL1FeeUpperBound(uint256)(uint256)", unsigned_size_bound)
        unsigned = {
            "type": "0x2", "chainId": "0xc4", "to": to, "data": data,
            "value": hex(value), "gas": hex(gas_limit), "maxFeePerGas": hex(MAX_FEE),
            "maxPriorityFeePerGas": hex(PRIORITY),
        }
        tx = dict(unsigned, chainId="0x7a69", **{"from": sender})
        estimate = int(rpc(LOCAL, "eth_estimateGas", json.dumps(tx)), 16)
        assert estimate <= gas_limit
        actual = send_only_on_fork(tx)
        raw_events[actual["transactionHash"]] = actual["logs"]
        receipt = {
            "label": label, "transactionHash": actual["transactionHash"], "status": 1,
            "block": int(actual["blockNumber"], 16), "blockHash": actual["blockHash"],
            "gasUsed": int(actual["gasUsed"], 16),
            "effectiveForkGasPriceWei": str(int(actual["effectiveGasPrice"], 16)),
            "preSendEstimatedGas": estimate, "l1OracleFeeUpperBoundAtPinWei": str(l1),
            "unsignedSizeBoundBytes": unsigned_size_bound,
        }
        balance = uint(TRANSISTORS, "balanceOf(address,uint256)(uint256)", sender, nand)
        if sequence == 0:
            assert balance - initial_balance == gates
        else:
            fixture = policies[sequence - 1]
            received_id = uint(CPU, "nextId()(uint256)")
            assert received_id == first_id + sequence
            assert view(CPU, "ownerOf(uint256)(address)", received_id).lower() == sender.lower()
            assert view(CPU, "netlist(uint256)(bytes)", received_id) == fixture["netlist"]
            dims = list(map(int, view(CPU, "circuitInfo(uint256)(uint32,uint32,uint32,uint32)", received_id).splitlines()))
            assert dims == [20, 1, 0, fixture["gateCount"]]
            assert prev_balance - balance == fixture["gateCount"]
            tape_topic = cast("sig-event", "TapedOut(uint256,address,uint32,uint32)")
            ev = next(e for e in actual["logs"] if e["address"].lower() == CPU and e["topics"][0] == tape_topic)
            assert int(ev["topics"][1], 16) == received_id and ev["topics"][2][-40:] == sender[2:]
            vectors = []
            for vector in fixture["vectors"]:
                out = view(CPU, "eval(uint256,bytes)(bytes)", received_id, vector["inputs"])
                assert out == vector["output"]
                vectors.append({"input": vector["inputs"], "output": out})
            receipt.update({"forkCircuitId": str(received_id), "dimensions": dims,
                            "netlistHash": fixture["netlistHash"], "evalVectors": vectors})
        receipt["nandBalanceAfter"] = str(balance)
        proposals.append({"sequence": sequence + 1, "label": label, "unsigned": unsigned,
                          "valueWei": str(value), "proposedGasLimit": gas_limit})
        receipts.append(receipt)
        prev_balance = balance
    assert prev_balance == initial_balance
    print(json.dumps({"observations": state, "proposedMainnetCalls": proposals,
                      "forkRehearsal": receipts, "forkReceiptLogs": raw_events}, indent=2))


if __name__ == "__main__":
    main()
