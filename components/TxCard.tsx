"use client";

import { useState } from "react";
import type { Address, Hex } from "viem";
import { useAccount, usePublicClient, useSendTransaction, useSwitchChain } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";

type ChainId = (typeof wagmiConfig.chains)[number]["id"];

export interface TxProposalView {
  kind: "transaction-proposal";
  chain: string;
  chainId: number;
  summary: string;
  steps: { label: string; to: Address; data: Hex; value: string }[];
  healthFactor: { before: number | null; after: number | null };
}

type StepState = "idle" | "signing" | "pending" | "done" | "error";

function hfColor(hf: number | null) {
  if (hf === null) return "text-emerald-400";
  if (hf < 1.1) return "text-red-400";
  if (hf < 1.5) return "text-amber-400";
  return "text-emerald-400";
}

export function TxCard({ proposal }: { proposal: TxProposalView }) {
  const chainId = proposal.chainId as ChainId;
  const { chainId: walletChain, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const publicClient = usePublicClient({ chainId });
  const [states, setStates] = useState<StepState[]>(proposal.steps.map(() => "idle"));
  const [hashes, setHashes] = useState<(Hex | undefined)[]>([]);
  const [error, setError] = useState<string>();

  const current = states.findIndex((s) => s !== "done");
  const busy = states.some((s) => s === "signing" || s === "pending");

  const set = (i: number, s: StepState) => setStates((prev) => prev.map((v, j) => (j === i ? s : v)));

  async function signNext() {
    if (current < 0) return;
    const step = proposal.steps[current]!;
    setError(undefined);
    try {
      if (walletChain !== chainId) await switchChainAsync({ chainId });
      set(current, "signing");
      const hash = await sendTransactionAsync({ chainId, to: step.to, data: step.data, value: BigInt(step.value) });
      setHashes((h) => {
        const next = [...h];
        next[current] = hash;
        return next;
      });
      set(current, "pending");
      const receipt = await publicClient!.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Transaction reverted");
      set(current, "done");
    } catch (e) {
      set(current, "error");
      setError(e instanceof Error ? e.message.split("\n")[0] : String(e));
    }
  }

  const allDone = current === -1;

  return (
    <div className="mt-2 rounded-xl border border-violet-500/40 bg-violet-500/5 p-4">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-violet-300">Transaction proposal · {proposal.chain}</div>
      <div className="text-sm">{proposal.summary}</div>

      <div className="mt-3 flex items-center gap-2 text-sm">
        <span className="text-zinc-400">Health factor</span>
        <span className={hfColor(proposal.healthFactor.before)}>{proposal.healthFactor.before ?? "∞"}</span>
        <span className="text-zinc-500">→</span>
        <span className={`font-semibold ${hfColor(proposal.healthFactor.after)}`}>{proposal.healthFactor.after ?? "∞"}</span>
      </div>

      <ol className="mt-3 space-y-1.5 text-sm">
        {proposal.steps.map((s, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="w-5 text-center">
              {{ idle: "○", signing: "✍️", pending: "⏳", done: "✅", error: "⚠️" }[states[i]!]}
            </span>
            <span className={states[i] === "done" ? "text-zinc-400" : ""}>{s.label}</span>
            {hashes[i] && <code className="ml-auto truncate text-xs text-zinc-500">{hashes[i]!.slice(0, 10)}…</code>}
          </li>
        ))}
      </ol>

      {error && <div className="mt-2 text-xs text-red-400">{error}</div>}

      <div className="mt-4">
        {allDone ? (
          <div className="text-sm text-emerald-400">Done. Ask me to re-check your position.</div>
        ) : (
          <button
            onClick={signNext}
            disabled={!isConnected || busy}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium hover:bg-violet-500 disabled:opacity-50"
          >
            {busy ? "Waiting for wallet…" : `Review & sign step ${current + 1} of ${proposal.steps.length}`}
          </button>
        )}
        <p className="mt-2 text-xs text-zinc-500">Nothing is sent until you confirm in your wallet.</p>
      </div>
    </div>
  );
}
