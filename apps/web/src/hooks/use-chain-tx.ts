"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { TxState } from "@/components/domain/tx-feedback";
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
      return result;
    },
    [queryClient],
  );
  const reset = useCallback(() => setState(IDLE), []);
  return { state, run, reset };
}
