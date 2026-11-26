// All writes use the disposable, literal loopback below. The upstream client has read methods only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';
import { createPublicClient, createWalletClient, decodeErrorResult, encodeFunctionData, getAddress, http, keccak256, parseAbi, parseEventLogs, toHex } from 'viem';

const rpcUrl = 'https://rpc.xlayer.tech', url = 'http://127.0.0.1:19720';
const pin = 76931173n, pinHash = '0x10908ada4cb486c8d506ba492aca1927e47a5a51e56f19e444f06f46c3acb574';
const notes = JSON.parse(readFileSync('evidence/session5-venues/observations.json')).mainnet;
const manager = getAddress('0x315e413A11AB0df498eF83873012430ca36638Ae'), factory = getAddress(notes.runtime.uniV3Factory.address);
const pool = getAddress(notes.uniV3.pool), usdc = getAddress(notes.uniV3.token0), wokb = getAddress(notes.uniV3.token1), router = getAddress(notes.runtime.uniV3Router.address);
const publicRead = createPublicClient({ transport: http(rpcUrl, { retryCount: 3 }), cacheTime: 0 });
const rpc = createPublicClient({ transport: http(url, { retryCount: 0, timeout: 60000 }), cacheTime: 0 });
const wallet = createWalletClient({ transport: http(url, { retryCount: 0, timeout: 60000 }) });
const abi = parseAbi(['function factory() view returns(address)', 'function WETH9() view returns(address)', 'function token0() view returns(address)',
    'function token1() view returns(address)', 'function getPool(address,address,uint24) view returns(address)', 'function fee() view returns(uint24)',
    'function tickSpacing() view returns(int24)', 'function liquidity() view returns(uint128)', 'function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)',
    'function decimals() view returns(uint8)', 'function deposit() payable', 'function approve(address,uint256) returns(bool)', 'function transfer(address,uint256) returns(bool)',
    'function balanceOf(address) view returns(uint256)', 'function allowance(address,address) view returns(uint256)', 'function ownerOf(uint256) view returns(address)',
    'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns(uint256)',
    'event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)',
    'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)',
    'event IncreaseLiquidity(uint256 indexed tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)',
    'event Collect(uint256 indexed tokenId,address recipient,uint256 amount0,uint256 amount1)',
    'event DecreaseLiquidity(uint256 indexed tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)']);
const artifact = JSON.parse(readFileSync('contracts/expansion/out/ForkLiquidityAccount.sol/ForkLiquidityAccount.json')), acctAbi = artifact.abi;
const output = {
    label: 'FORK only, private Anvil chain 31337. Amounts and fees observed on this historical fork. UI disabled.',
    upstream: { url: rpcUrl, chainId: 196, block: pin, hash: pinHash },
    bindings: { manager, factory, pool, router, usdc, wokb },
    official: 'https://developers.uniswap.org/docs/protocols/v3/deployments/v3-xlayer-deployments',
    receipts: [],
};

const upstream = (address, functionName, args = []) => publicRead.readContract({ address, abi, functionName, args, blockNumber: pin });
const status = await publicRead.getBlock({ blockNumber: pin });
assert.equal(await publicRead.getChainId(), 196);
assert.equal(status.hash, pinHash);
const observed = await Promise.all([upstream(manager, 'factory'), upstream(manager, 'WETH9'), upstream(factory, 'getPool', [usdc, wokb, 500]),
    upstream(pool, 'factory'), upstream(pool, 'token0'), upstream(pool, 'token1'), upstream(pool, 'fee'), upstream(pool, 'tickSpacing'),
    upstream(usdc, 'decimals'), upstream(wokb, 'decimals'), upstream(pool, 'liquidity'), upstream(pool, 'slot0')]);
assert.deepEqual(observed.slice(0, 10), [factory, wokb, pool, factory, usdc, wokb, 500, 10, 6, 18]);
assert(observed[10] > 0n);
assert(observed[11][6]);
output.pinState = { managerFactory: observed[0], managerWrappedNative: observed[1], factoryPool: observed[2], poolTokens: observed.slice(4, 6), fee: 500, tickSpacing: 10,
    decimals: observed.slice(8, 10), liquidity: observed[10], sqrtPriceX96: observed[11][0], tick: observed[11][1], codeHashes: {} };
for (const [key, addr] of Object.entries(output.bindings))
    output.pinState.codeHashes[key] = keccak256(await publicRead.getCode({ address: addr, blockNumber: pin }));

assert.equal(await fetch(url, { signal: AbortSignal.timeout(500) }).then(() => true, () => false), false, 'Fork port occupied');
const anvil = spawn('anvil', ['--host', '127.0.0.1', '--port', '19720', '--chain-id', '31337', '--fork-url', rpcUrl, '--fork-block-number', String(pin), '--no-storage-caching', '--silent'], { stdio: ['ignore', 'ignore', 'inherit'] });
const exited = once(anvil, 'exit'), stop = () => anvil.kill('SIGTERM');
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
try {
    let info;
    for (let i = 0; !info && i < 100; i++) {
        try {
            info = await rpc.request({ method: 'anvil_nodeInfo' });
        }
        catch {
            await wait(200);
        }
    }
    assert.equal(info?.forkConfig.forkUrl, rpcUrl);
    assert.equal(BigInt(info.forkConfig.forkBlockNumber), pin);
    assert.equal(await rpc.getChainId(), 31337);
    assert.equal((await rpc.getBlock()).hash, pinHash);
    const actors = [];
    for (const address of await wallet.getAddresses()) {
        if (!await rpc.getCode({ address })) actors.push(getAddress(address));
        if (actors.length === 2) break;
    }
    const [owner, trader] = actors;
    assert(owner && trader);
    output.actors = { owner, trader };

    async function send(label, request, actor = owner, expected = 'success') {
        await rpc.request({ method: 'evm_setNextBlockTimestamp', params: [toHex(status.timestamp + BigInt(output.receipts.length) + 1n)] });
        const nonce = await rpc.getTransactionCount({ address: actor, blockTag: 'latest' });
        const hash = await wallet.sendTransaction({
            chain: null, account: actor, nonce, gasPrice: 10_000_000_000n, gas: 12_000_000n, ...request
        });
        console.error(label, hash);
        let receipt;
        for (let i = 0; i < 200 && !receipt; i++) {
            const mined = await rpc.request({ method: 'eth_getTransactionReceipt', params: [hash] });
            if (mined) receipt = await rpc.getTransactionReceipt({ hash });
            else await wait(300);
        }
        assert(receipt, 'Missing receipt for ' + label + ' ' + hash);
        assert.equal(receipt.status, expected, label + ' ' + hash);
        assert.equal((await rpc.getBlock({ blockNumber: receipt.blockNumber })).hash, receipt.blockHash);
        output.receipts.push({
            label, hash, status: receipt.status, block: receipt.blockNumber, blockHash: receipt.blockHash,
            gas: receipt.gasUsed, from: receipt.from, to: receipt.to, created: receipt.contractAddress
        });
        return receipt;
    }

    function write(label, to, interfaceAbi, functionName, args = [], actor = owner, value = 0n, expected = 'success') {
        const data = encodeFunctionData({ abi: interfaceAbi, functionName, args });
        return send(label, { to, data, value }, actor, expected);
    }
    const read = (address, functionName, args = [], interfaceAbi = abi) => rpc.readContract({ address, abi: interfaceAbi, functionName, args });
    function event(receipt, address, interfaceAbi, eventName) {
        const logs = receipt.logs.filter(log => getAddress(log.address) === address);
        const events = parseEventLogs({ abi: interfaceAbi, logs, eventName });
        assert.equal(events.length, 1, eventName);
        return events[0].args;
    }

    const account = getAddress((await send('Deploy separate fork LP account', { data: artifact.bytecode.object })).contractAddress);
    output.account = account;
    output.accountCreationCodeHash = keccak256(artifact.bytecode.object);
    output.accountRuntimeHash = keccak256(await rpc.getCode({ address: account }));
    const balance = (token, holder) => read(token, 'balanceOf', [holder]);
    const wad = 10n ** 18n;
    async function swap(label, actor, amount, minOut) {
        await write('Approve ' + label, wokb, abi, 'approve', [router, amount], actor);
        const r = await write(label, router, abi, 'exactInputSingle', [{ tokenIn: wokb, tokenOut: usdc, fee: 500, recipient: actor, amountIn: amount, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }], actor);
        const e = event(r, pool, abi, 'Swap');
        assert.equal(e.amount1, amount);
        assert(-e.amount0 >= minOut);
        assert.equal(getAddress(e.recipient), actor);
        return { ...e, tx: r.transactionHash };
    }
    await write('Wrap owner fork OKB', wokb, abi, 'deposit', [], owner, 6n * wad);
    output.bootstrapSwap = await swap('Acquire real USDC for owner on fork', owner, 3n * wad, 230000000n);
    await write('Fund LP account with WOKB', wokb, abi, 'transfer', [account, 2n * wad]);
    await write('Fund LP account with USDC', usdc, abi, 'transfer', [account, 150000000n]);
    const lower = 8480269488078033598680571283421593n, upper = 9004633054855875436865350762538812n, q = 1n << 96n;
    const [price] = await read(pool, 'slot0'), liq = wad * q / (price - lower);
    const target0 = (liq * q * (upper - price) / upper / price);
    const max0 = target0 * 1001n / 1000n, max1 = wad * 1001n / 1000n, min0 = max0 - max0 / 100n, min1 = max1 - max1 / 100n;
    const deadline = status.timestamp + 300n;
    const opened = await write('Mint one fixed range position', account, acctAbi, 'open', [max0, max1, min0, min1, deadline]);
    const op = event(opened, account, acctAbi, 'Opened'), mint = event(opened, manager, abi, 'IncreaseLiquidity'), nft = event(opened, manager, abi, 'Transfer');
    const id = op.id;
    assert.equal(nft.tokenId, id);
    assert.equal(getAddress(nft.to), account);
    assert.equal(mint.liquidity, op.liquidity);
    assert.equal(mint.amount0, op.usdcIn);
    assert.equal(mint.amount1, op.wokbIn);
    const [liveId, position] = await read(account, 'position', [], acctAbi);
    assert.equal(liveId, id);
    assert.equal(position.liquidity, mint.liquidity);
    assert.equal(getAddress(await read(manager, 'ownerOf', [id])), account);
    const approvals = await Promise.all([usdc, wokb].map(a => read(a, 'allowance', [account, manager])));
    assert.deepEqual(approvals, [0n, 0n]);
    output.open = { positionId: id, tickLower: position.tickLower, tickUpper: position.tickUpper, liquidity: position.liquidity, limits: { max0, max1, min0, min1, deadline },
        tokenOwner: account, managerEvent: mint, accountEvent: op, approvals };
    const reject = async (label, fn, args, actor, why) => {
        const r = await write(label, account, acctAbi, fn, args, actor, 0n, 'reverted');
        const t = await rpc.request({ method: 'debug_traceTransaction', params: [r.transactionHash, { tracer: 'callTracer' }] });
        assert.equal(decodeErrorResult({ abi: acctAbi, data: t.output }).errorName, why);
        return { hash: r.transactionHash, error: why };
    };
    output.denials = [
        await reject('Second position rejected', 'open', [max0, max1, min0, min1, deadline], owner, 'ClosedOrOccupied'),
        await reject('Foreign caller rejected', 'collectFees', [], trader, 'OwnerOnly'),
        await reject('Foreign withdrawal rejected', 'withdraw', [usdc, 1n], trader, 'OwnerOnly'),
        await reject('Zero removal floors rejected', 'close', [0n, 0n, deadline], owner, 'Bounds'),
    ];
    await write('Wrap independent trader fork OKB', wokb, abi, 'deposit', [], trader, 10n * wad);
    output.feeGeneratingSwap = await swap('Independent trader swaps through approved pool', trader, 10n * wad, 780000000n);
    const before = await balance(wokb, account);
    const f = await write('Collect trading fees before any liquidity removal', account, acctAbi, 'collectFees');
    const fees = event(f, manager, abi, 'Collect'), booked = event(f, account, acctAbi, 'FeesCollected');
    assert.equal(fees.tokenId, id);
    assert.equal(getAddress(fees.recipient), account);
    assert.equal(fees.amount0, booked.usdcFees);
    assert.equal(fees.amount1, booked.wokbFees);
    assert(fees.amount1 > 0n);
    assert.equal(await balance(wokb, account) - before, fees.amount1);
    assert.equal((await read(account, 'position', [], acctAbi))[1].liquidity, mint.liquidity);
    output.fees = { managerEvent: fees, accountEvent: booked, liquidityUnchanged: true };
    const [principal0, principal1] = await read(account, 'previewPrincipal', [], acctAbi);
    const e = await write('Remove full liquidity, collect principal and burn the NFT', account, acctAbi, 'close', [principal0 - principal0 / 1000n, principal1 - principal1 / 1000n, deadline]);
    const removed = event(e, manager, abi, 'DecreaseLiquidity'), collected = event(e, manager, abi, 'Collect'), burn = event(e, manager, abi, 'Transfer'), closed = event(e, account, acctAbi, 'Closed');
    assert.equal(removed.liquidity, mint.liquidity);
    assert.equal(removed.amount0, principal0);
    assert.equal(removed.amount1, principal1);
    assert.equal(getAddress(collected.recipient), account);
    assert.equal(collected.amount0, closed.usdcReceived);
    assert.equal(collected.amount1, closed.wokbReceived);
    assert.equal(burn.tokenId, id);
    assert.equal(getAddress(burn.from), account);
    assert.equal(BigInt(burn.to), 0n);
    assert.equal(await read(account, 'tokenId', [], acctAbi), 0n);
    output.close = { preview: [principal0, principal1], managerDecrease: removed, managerCollect: collected, nftBurn: burn, accountEvent: closed };
    const withdrawals = [];
    for (const asset of [usdc, wokb]) {
        const amount = await balance(asset, account), ownerBefore = await balance(asset, owner);
        await write('Withdraw idle ' + (asset === usdc ? 'USDC' : 'WOKB') + ' to owner', account, acctAbi, 'withdraw', [asset, amount]);
        assert.equal(await balance(asset, account), 0n);
        assert.equal(await balance(asset, owner) - ownerBefore, amount);
        assert.equal(await read(asset, 'allowance', [account, manager]), 0n);
        withdrawals.push({ asset, amount, recipient: owner, accountBalanceAfter: 0n, allowanceAfter: 0n });
    }
    output.withdrawals = withdrawals;
    writeFileSync('evidence/session7-lp/fork.json', JSON.stringify(output, (_, v) => typeof v === 'bigint' ? String(v) : v, 2) + '\n');
    console.log('Complete LP lifecycle', String(id), 'WOKB fee raw', String(fees.amount1), output.receipts.length, 'fork transactions');
}
finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    if (anvil.exitCode === null && anvil.signalCode === null)
        stop();
    await exited;
}
