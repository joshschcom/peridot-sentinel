"""Verify saved X Layer event receipts and circuit vectors using read-only RPC. Run at repo root."""
import json
import subprocess
import sys
import time
from pathlib import Path

BASE = Path("evidence/a1")
RPC = "https://rpc.xlayer.tech"


def request_batch(calls):
    payload = [
        {"id": i, "jsonrpc": "2.0", "method": method, "params": params}
        for i, (method, params) in enumerate(calls)
    ]
    for attempt in range(6):
        response = subprocess.run(
            ["curl", "-fsS", "--max-time", "20", "-H", "Content-Type: application/json",
             "--data", json.dumps(payload), RPC],
            capture_output=True, text=True,
        )
        if response.returncode == 0:
            try:
                result = {item["id"]: item["result"] for item in json.loads(response.stdout)}
                return [result[i] for i in range(len(calls))]
            except (KeyError, TypeError, ValueError):
                pass
        time.sleep(1 + attempt)
    raise RuntimeError(f"RPC did not complete batch starting with {calls[0][0]}")


def verify_events(index, pin):
    for offset in range(0, len(index["events"]), 4):
        batch = index["events"][offset:offset + 4]
        calls = []
        for event in batch:
            calldata = "0x4bc7cbbd" + format(event["index"], "064x")
            calls.extend([
                ("eth_getTransactionReceipt", [event["tx"]]),
                ("eth_call", [{"to": index["factory"], "data": calldata}, pin]),
            ])
        result = request_batch(calls)
        for i, event in enumerate(batch):
            receipt, value = result[i * 2:i * 2 + 2]
            assert event["index"] == offset + i
            assert value[-40:].lower() == event["processor"][2:].lower()
            assert int(receipt["status"], 16) == 1
            assert int(receipt["blockNumber"], 16) == event["block"]
            log = next(row for row in receipt["logs"] if int(row["logIndex"], 16) == event["logIndex"])
            assert log["address"].lower() == index["factory"].lower()
            assert log["topics"][0].lower() == index["topic0"].lower()
            assert log["topics"][1][-40:].lower() == event["processor"][2:].lower()
            assert log["topics"][2][-40:].lower() == event["transistors"][2:].lower()
    print(f"{len(index['events'])} matched events, receipts and cpuAt entries")


def verify_circuit(snapshot):
    # Pinned upstream clone provides TAP-02's independent evaluator.
    sys.path.insert(0, ".research/TAPs/assets/tap-02")
    import reference

    circuit = snapshot["circuit"]
    addr = circuit["processor"]
    pin = str(snapshot["block"])

    def read(sig, *args):
        return subprocess.check_output(
            ["cast", "call", "-r", RPC, "-b", pin, addr, sig, *map(str, args)],
            text=True,
        ).strip()

    dimensions = read("circuitInfo(uint256)(uint32,uint32,uint32,uint32)", circuit["id"])
    assert list(map(int, dimensions.splitlines())) == circuit["dimensions"]
    blob = read("netlist(uint256)(bytes)", circuit["id"])
    assert blob == circuit["netlist"]
    model = reference.load(bytes.fromhex(blob[2:]), *circuit["dimensions"][:2])
    for vector in circuit["vectors"]:
        raw = bytes.fromhex(vector["input"][2:])
        _, bits = reference.beat(model, [], reference.unpack(raw, model.n_in))
        output = "0x" + reference.pack(bits).hex()
        assert output == vector["reference"] == vector["output"]
        assert read("eval(uint256,bytes)(bytes)", circuit["id"], vector["input"]) == output
    print(f"{len(circuit['vectors'])} matched public eval and upstream reference vectors")


def main():
    index = json.loads((BASE / "factory-events.json").read_text())
    snapshot = json.loads((BASE / "mainnet-reads.json").read_text())
    assert index["toBlock"] == snapshot["block"]
    pin = hex(snapshot["block"])
    chain, block, count = request_batch([
        ("eth_chainId", []), ("eth_getBlockByNumber", [pin, False]),
        ("eth_call", [{"to": index["factory"], "data": "0xa94da8a7"}, pin]),
    ])
    assert int(chain, 16) == index["chainId"] == 196
    assert block["hash"] == snapshot["blockHash"]
    assert int(count, 16) == len(index["events"]) == index["count"]
    verify_events(index, pin)
    verify_circuit(snapshot)


if __name__ == "__main__":
    main()
