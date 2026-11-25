"""Run from the repo root against a fresh fork. Writes only to local Anvil. Print JSON results."""
import json
import subprocess
import time
from pathlib import Path

LOCAL_RPC = "http://127.0.0.1:19621"
BLOCK = 76844958
PROCESSOR = "0x423446eefaa885b804c7bd9b0bdd130ce2ee00b5"
STATEFUL = "0x0565EA48CA41Ae559d8d491dbb0a9ec945DB551b"


def cast(*args):
    return subprocess.check_output(["cast", *map(str, args)], text=True).strip()


def rpc(method, *args):
    return json.loads(cast("rpc", "-r", LOCAL_RPC, method, *args))


def read(address, signature, *args):
    for attempt_index in range(4):
        try:
            return cast("call", "-r", LOCAL_RPC, address, signature, *args)
        except subprocess.CalledProcessError:
            if attempt_index == 3:
                raise
            time.sleep(1 + attempt_index)


def integer(address, signature, *args):
    return int(read(address, signature, *args).split()[0])


def attempt(address, signature, *args):
    result = subprocess.run(
        ["cast", "call", "-r", LOCAL_RPC, address, signature, *map(str, args)],
        capture_output=True, text=True,
    )
    if result.returncode == 0:
        raise AssertionError(f"expected a rejection for {signature}")
    return result.stderr.strip()


def send(sender, target, calldata, value=0):
    tx = {"from": sender, "data": calldata, "value": hex(value), "gas": hex(5_000_000)}
    if target:
        tx["to"] = target
    tx_hash = rpc("eth_sendTransaction", json.dumps(tx))
    for _ in range(80):
        receipt = rpc("eth_getTransactionReceipt", tx_hash)
        if receipt:
            break
        time.sleep(0.25)
    if receipt is None:
        raise TimeoutError(tx_hash)
    assert int(receipt["status"], 16) == 1, f"fork transaction reverted: {tx_hash}"
    return {
        "hash": tx_hash, "block": int(receipt["blockNumber"], 16),
        "gasUsed": int(receipt["gasUsed"], 16), "valueWei": str(value),
        "contractAddress": receipt["contractAddress"],
    }


def main():
    info = rpc("anvil_nodeInfo")
    fork = info["forkConfig"]
    if (info["environment"]["chainId"] != 31337 or fork["forkBlockNumber"] != BLOCK
            or fork["forkUrl"] != "https://rpc.xlayer.tech"
            or int(info["currentBlockNumber"], 16) != BLOCK):
        raise RuntimeError("start a fresh loopback X Layer fork at the documented block")
    sender = next(
        a for a in rpc("eth_accounts")
        if cast("code", "-r", LOCAL_RPC, a) == "0x"
    )
    artifact = json.loads(Path(".research/probe-out/ProcessorProbe.sol/ProcessorProbe.json").read_text())
    probe_receipt = send(sender, None, artifact["bytecode"]["object"])
    probe = probe_receipt["contractAddress"]

    fixtures = json.loads(Path("packages/circuit-sdk/fixtures/policies-v1.json").read_text())["policies"]
    transistors = read(PROCESSOR, "transistors()(address)")
    nand = integer(transistors, "NAND()(uint256)")
    assert nand == 0
    count = sum(policy["gateCount"] for policy in fixtures)
    price = integer(transistors, "mintPrice()(uint256)")
    fee = integer(transistors, "protocolFee()(uint256)")
    fabrication_fee = integer(PROCESSOR, "TAPEOUT_FEE()(uint256)")
    balance_sig = "balanceOf(address,uint256)(uint256)"
    before = integer(transistors, balance_sig, sender, nand)
    remaining = integer(transistors, "supplyCap()(uint256)") - integer(transistors, "minted()(uint256)")
    assert remaining >= count
    mint = send(sender, transistors, cast("calldata", "mint(uint256,uint256)", nand, count), price * count + fee)
    assert integer(transistors, balance_sig, sender, nand) - before == count
    evidence = {
        "environment": "Anvil local fork simulation", "chainId": 31337,
        "sourceChainId": 196, "sourceBlock": BLOCK, "sourceRpc": fork["forkUrl"],
        "sender": sender, "processor": PROCESSOR, "transistors": transistors,
        "mintPriceWeiPerUnit": str(price), "mintProtocolFeeWei": str(fee),
        "fabricationFeeWeiPerCircuit": str(fabrication_fee), "nandMinted": count, "remainingBeforeMint": str(remaining),
        "mint": mint, "solidityProbe": probe_receipt, "policies": [],
    }
    for policy in fixtures:
        prev = integer(PROCESSOR, "nextId()(uint256)")
        before = integer(transistors, balance_sig, sender, nand)
        payload = cast("calldata", "tapeout(bytes,uint32,uint32)", policy["netlist"], policy["nIn"], policy["nOut"])
        receipt = send(sender, PROCESSOR, payload, fabrication_fee)
        circuit = integer(PROCESSOR, "nextId()(uint256)")
        nands = before - integer(transistors, balance_sig, sender, nand)
        assert circuit == prev + 1 and nands == policy["gateCount"]
        dimensions = list(map(int, read(PROCESSOR, "circuitInfo(uint256)(uint32,uint32,uint32,uint32)", circuit).splitlines()))
        assert dimensions == [policy[k] for k in ["nIn", "nOut", "nState", "gateCount"]]
        assert read(PROCESSOR, "netlist(uint256)(bytes)", circuit) == policy["netlist"]
        observed = []
        for vector in policy["vectors"]:
            values = read(probe, "evaluate(address,uint256,bytes)(bool,uint256)", PROCESSOR, circuit, vector["inputs"]).splitlines()
            expected = vector["output"] == "0x01"
            assert (values[0] == "true") == expected
            observed.append({"input": vector["inputs"], "allow": expected, "solidityCallGas": int(values[1].split()[0])})
        evidence["policies"].append({
            "kind": policy["spec"]["kind"], "id": circuit, "netlistHash": policy["netlistHash"],
            "dimensions": dimensions, "nandBurned": nands, "fabrication": receipt, "vectors": observed,
        })

    market = evidence["policies"][0]["id"]
    evidence["failureBehavior"] = {
        "shortRawInputResult": read(PROCESSOR, "eval(uint256,bytes)(bytes)", market, "0x"),
        "longRawInputResult": read(PROCESSOR, "eval(uint256,bytes)(bytes)", market, "0x922c0bff"),
        "shortSolidityInput": attempt(probe, "evaluate(address,uint256,bytes)(bool,uint256)", PROCESSOR, market, "0x"),
        "statefulProcessor": STATEFUL, "statefulCircuitId": 1,
        "statefulEval": attempt(probe, "evaluate(address,uint256,bytes)(bool,uint256)", STATEFUL, 1, "0x000000"),
        "missingCircuitEval": attempt(probe, "evaluate(address,uint256,bytes)(bool,uint256)", PROCESSOR, 0, "0x000000"),
    }
    # Run the same vectors through Peridot's actual adapter and its registrar.
    def deploy(name, argument):
        artifact = Path(f"contracts/out/{name}.sol/{name}.json")
        creation = json.loads(artifact.read_text())["bytecode"]["object"]
        constructor_word = cast("abi-encode", "f(address)", argument)[2:]
        return send(sender, None, creation + constructor_word)

    registry_deployment = deploy("PolicyRegistry", sender)
    registry = registry_deployment["contractAddress"]
    adapter_deployment = deploy("TapeOutPolicyAdapter", registry)
    adapter = adapter_deployment["contractAddress"]
    trust = send(sender, registry, cast("calldata", "setProcessorTrust(address,bool)", PROCESSOR, "true"))
    evidence["peridotAdapter"] = {
        "registry": registry_deployment, "adapter": adapter_deployment,
        "trustReceipt": trust, "forwardedGasLimit": integer(adapter, "EVAL_GAS()(uint256)"),
        "policies": [],
    }
    for kind, (fixture, measured) in enumerate(zip(fixtures, evidence["policies"])):
        signature = "register(address,uint256,uint8,bytes32,bytes32,bytes32)"
        args = [PROCESSOR, measured["id"], kind, fixture["netlistHash"], fixture["configHash"], "0x" + "00" * 32]
        policy_id = cast("call", "-r", LOCAL_RPC, "--from", sender, registry, signature + "(bytes32)", *args)
        registration = send(sender, registry, cast("calldata", signature, *args))
        reason = ["MarketPolicyRejected(bytes32,uint8)", "AccountPolicyRejected(bytes32,uint8)"][kind]
        selector = cast("sig", reason)
        checks = []
        for vector in fixture["vectors"]:
            ctx = vector["context"]
            args = [policy_id, kind, ctx["op"], str(ctx["oracleFresh"]).lower(), ctx["postLtvBps"], str(ctx["cashOk"]).lower()]
            signature = "enforce(bytes32,uint8,uint8,bool,uint256,bool)"
            expected = vector["output"] == "0x01"
            if expected:
                read(adapter, signature, *args)
            else:
                assert selector in attempt(adapter, signature, *args)
            checks.append({"input": vector["inputs"], "result": "allow" if expected else reason})
        evidence["peridotAdapter"]["policies"].append({
            "policyId": policy_id, "registrationReceipt": registration, "vectors": checks,
        })
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    main()
