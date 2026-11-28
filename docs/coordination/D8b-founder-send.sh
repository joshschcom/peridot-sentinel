#!/bin/sh
# D8(b) founder signing: sends the four reviewed calls on X Layer MAINNET (196), in order, one confirmation each.
# Run it YOURSELF in your own terminal (not through an AI session). Your key never leaves your signer.
#
#   sh docs/coordination/D8b-founder-send.sh 0xYourPublicSenderAddress            # cast prompts for the key (hidden)
#   SIGNER="--ledger" sh docs/coordination/D8b-founder-send.sh 0xYour...           # Ledger
#   SIGNER="--account founder" sh docs/coordination/D8b-founder-send.sh 0xYour...  # cast keystore (password prompt)
#
# Before running: `sh docs/coordination/D8b-presign-check.sh 0xYour...` must pass for the same address.
# The calls carry 0.00456 OKB of value in total (0.00066 to the NAND contract, 3 x 0.0013 to CPU #410), plus gas.
# Approved ceiling for everything: 0.004647 OKB. The NANDs and the three circuit NFTs go to the sender (msg.sender);
# no calldata contains any recipient address.
set -eu
cd "$(dirname "$0")/../.."
SENDER="${1:-}"
case "$SENDER" in 0x[0-9a-fA-F]*) [ ${#SENDER} -eq 42 ] || { echo "Pass your public 0x sender address"; exit 1; } ;; *) echo "Pass your public 0x sender address"; exit 1 ;; esac
SIGNER="${SIGNER:---interactive}"
RPC="https://rpc.xlayer.tech"
[ "$(cast chain-id --rpc-url "$RPC")" = "196" ] || { echo "RPC is not X Layer mainnet 196"; exit 1; }

# Read the reviewed envelopes and refuse unless target, value, gas, fees and selector are exactly the reviewed ones.
CALLS="$(node -e '
const c=require("./evidence/session5-d8b/proposal-and-fork.json").proposedMainnetCalls;
const want=[
 ["Mint 209 NAND","0x3896076BE165d6a7eC2a70CCF6876673fE245007","0x25844398d4000","0x1d4c0","0x1b2ef1ca"],
 ["Market Policy V1","0x423446EEFAa885B804C7bD9B0bdD130cE2Ee00B5","0x49e57d6354000","0x7ef40","0x7bd3ac1d"],
 ["Sentinel Policy V1","0x423446EEFAa885B804C7bD9B0bdD130cE2Ee00B5","0x49e57d6354000","0x8d9a0","0x7bd3ac1d"],
 ["Expanded Sentinel Policy V2 (EXECUTION)","0x423446EEFAa885B804C7bD9B0bdD130cE2Ee00B5","0x49e57d6354000","0x7ef40","0x7bd3ac1d"]];
if(c.length!==4)throw Error("expected 4 calls");
c.forEach((x,i)=>{const w=want[i];
 if(x.label!==w[0]||x.to!==w[1]||x.value!==w[2]||x.gas!==w[3]||!x.data.startsWith(w[4])||x.chainId!=="0xc4"||x.type!=="0x2"||x.maxFeePerGas!=="0x2faf080"||x.maxPriorityFeePerGas!=="0x1")throw Error("envelope "+i+" differs from the reviewed one");
 console.log([i+1,x.to,BigInt(x.value).toString(),BigInt(x.gas).toString(),x.data,x.label.replace(/ /g,"_")].join(" "))});
')"

echo "Sender: $SENDER   chain 196   balance: $(cast balance "$SENDER" --ether --rpc-url "$RPC") OKB"
HASHES="${TMPDIR:-/tmp}/d8b-founder-hashes.txt"; : > "$HASHES"
while read -r N TO VALUE GAS DATA LABEL; do
  echo
  echo "Call $N of 4: $(echo "$LABEL" | tr _ ' ')"
  echo "  to     $TO"
  echo "  value  $(cast from-wei "$VALUE") OKB   gas limit $GAS   max fee 0.05 gwei   tip 1 wei"
  printf "  Send this transaction? Type yes: "
  read -r ANSWER </dev/tty
  [ "$ANSWER" = "yes" ] || { echo "Stopped before call $N. Nothing more was sent."; exit 1; }
  # shellcheck disable=SC2086
  OUT="$(cast send "$TO" --data "$DATA" --value "$VALUE" --gas-limit "$GAS" --gas-price 50000000 --priority-gas-price 1 \
        --chain 196 --rpc-url "$RPC" --confirmations 2 --json $SIGNER </dev/tty)"
  HASH="$(echo "$OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log(r.transactionHash)})')"
  STATUS="$(echo "$OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log(String(r.status))})')"
  FROM="$(echo "$OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log(r.from.toLowerCase())})')"
  echo "  tx $HASH   status $STATUS"
  echo "  explorer https://www.okx.com/web3/explorer/xlayer/tx/$HASH"
  [ "$FROM" = "$(echo "$SENDER" | tr 'A-F' 'a-f')" ] || { echo "  The signer was $FROM, not $SENDER. Stopping."; exit 1; }
  case "$STATUS" in 1|0x1|true) ;; *) echo "  Call $N failed. Stopping; tell Claude before doing anything else."; exit 1 ;; esac
  case "$N" in 1) V=MINT_TX ;; 2) V=MARKET_TX ;; 3) V=ACCOUNT_TX ;; 4) V=EXECUTION_TX ;; esac
  echo "$V=$HASH" >> "$HASHES"
done <<EOF
$CALLS
EOF
echo
echo "Done. Send these four hashes to Claude (public data):"
cat "$HASHES"
