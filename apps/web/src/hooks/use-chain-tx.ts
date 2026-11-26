"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { TxState } from "@/components/domain/tx-feedback";
import { TARGET_KIND } from "@/lib/chains";
import { invalidateChainCaches } from "@/services/chain/reads";
import { type TxPlanStep, type TxRun, runPlan } from "@/services/chain/tx";

const IDLE: TxState = { phase: "idle", steps: [], result: null, simulated: false };

/** Runs a wallet transaction plan and refreshes every query once it is confirmed (or has failed). */
export function useChainTx() {
  const [state, setState] = useState<TxState>(IDLE);
  const queryClient = useQueryClient();
  const run = useCallback(
    async (plan: TxPlanStep[], successSummary: string): Promise<TxRun> => {
      const result = await runPlan(plan, successSummary, setState);
      invalidateChainCaches();
      await queryClient.invalidateQueries();
      // On a public RPC the first refresh can be answered by a backend that has not seen the new block yet.
      if (TARGET_KIND !== "local" && result.hashes.length > 0) window.setTimeout(() => void queryClient.invalidateQueries(), 4000);
      return result;
    },
    [queryClient],
  );
  const reset = useCallback(() => setState(IDLE), []);
  return { state, run, reset };
}
