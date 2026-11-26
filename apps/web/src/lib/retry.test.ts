import assert from "node:assert/strict";
import { test } from "node:test";
import { retryRead } from "./retry.ts";

test("a read that fails on lagging backends succeeds once one answers", async () => {
  let calls = 0;
  const value = await retryRead(async () => {
    if (++calls < 3) throw new Error("backend behind");
    return 7;
  }, { baseDelayMs: 1 });
  assert.equal(value, 7);
  assert.equal(calls, 3);
});

test("an empty answer is asked again, and a real answer is returned as soon as it appears", async () => {
  const answers = ["0x", "0x", "0x6080"];
  let calls = 0;
  const code = await retryRead(async () => answers[calls++]!, { baseDelayMs: 1, accept: (value) => value !== "0x" });
  assert.equal(code, "0x6080");
});

test("a persistent empty answer is returned after the last attempt, so a real mismatch is still reported", async () => {
  let calls = 0;
  const code = await retryRead(async () => (calls++, "0x"), { attempts: 4, baseDelayMs: 1, accept: (value) => value !== "0x" });
  assert.equal(code, "0x");
  assert.equal(calls, 4);
});

test("a persistent failure surfaces the last error after the bounded attempts", async () => {
  let calls = 0;
  await assert.rejects(retryRead(async () => { calls++; throw new Error("down"); }, { attempts: 3, baseDelayMs: 1 }), /down/);
  assert.equal(calls, 3);
});
