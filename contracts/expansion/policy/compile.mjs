// TAP-02 stateless NAND subset. Wires 0 and 1 are constants, inputs start at wire 2.
import { keccak256, toHex } from 'viem'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

function compile() {
  const gates = []
  const nand = (a,b) => { gates.push([a,b]); return 21 + gates.length }
  const not = a => nand(a,a)
  const and = (a,b) => not(nand(a,b))
  const or = (a,b) => nand(not(a),not(b))
  const input = bit => 2 + bit
  let matches = 1
  for (let bit = 0; bit < 8; bit++) {
    const required = (0xf5 >> bit) & 1
    matches = and(matches, required ? input(bit) : not(input(bit)))
  }
  // Compare unsigned loss against 100 from least to most significant.
  let within = 1
  for (let bit = 0; bit < 10; bit++) {
    const clear = not(input(8+bit))
    within = ((100 >> bit) & 1) ? or(clear,within) : and(clear,within)
  }
  const reservedZero = and(not(input(18)),not(input(19)))
  and(matches,and(within,reservedZero))
  const program = Buffer.alloc(gates.length * 7)
  gates.forEach(([a,b],i) => {
    program.writeUIntBE(a, i*7+1, 3)
    program.writeUIntBE(b, i*7+4, 3)
  })
  const netlist = toHex(program)
  return {schema:'sentinel-execution-swap-v1', nIn:20, nOut:1, nState:0,
    gateCount:gates.length, maxLossBps:100, netlistHash:keccak256(netlist), netlist}
}
export const executionCircuit = compile()
export function encodeSwap(checks, loss) {
  if (!Number.isInteger(checks) || checks<0 || checks>15 || !Number.isInteger(loss) || loss<0 || loss>1023) {
    throw new RangeError('invalid execution context')
  }
  const word = 5 | (checks<<4) | (loss<<8)
  return toHex(Uint8Array.of(word & 255, (word>>8) & 255, word>>16))
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = JSON.stringify(executionCircuit,null,2)+'\n'
  if (process.argv.includes('--check')) {
    if (readFileSync(new URL('./execution.json',import.meta.url),'utf8') !== output) throw Error('fixture mismatch')
  } else process.stdout.write(output)
}
