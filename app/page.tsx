"use client";

import { useChat } from "@ai-sdk/react";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { ConnectButton } from "@/components/ConnectButton";
import { TxCard, type TxProposalView } from "@/components/TxCard";

const CHAINS = ["base", "ethereum", "arbitrum", "optimism", "polygon"] as const;

const SUGGESTIONS = [
  "How risky is my Aave position?",
  "If ETH drops 30%, do I get liquidated?",
  "Best stablecoin supply rate on Base right now?",
  "Borrow 100 USDC — is that safe?",
];

const TOOL_LABELS: Record<string, string> = {
  getMarkets: "Reading Aave markets",
  getAccount: "Reading your position",
  simulate: "Simulating",
  proposeTransaction: "Preparing transaction",
};

interface ToolPartLike {
  type: string;
  state: "input-streaming" | "input-available" | "output-available" | "output-error";
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

function ToolPart({ part }: { part: ToolPartLike }) {
  const name = part.type.replace(/^tool-/, "");
  if (name === "proposeTransaction" && part.state === "output-available") {
    return <TxCard proposal={part.output as TxProposalView} />;
  }
  const label = TOOL_LABELS[name] ?? name;
  const icon = part.state === "output-available" ? "✓" : part.state === "output-error" ? "⚠" : "…";
  return (
    <div className="my-1 text-xs text-zinc-500">
      <span className={part.state === "output-error" ? "text-amber-400" : ""}>
        {icon} {label}
        {part.state === "output-error" && part.errorText ? ` — ${part.errorText}` : ""}
      </span>
    </div>
  );
}

export default function Home() {
  const { address } = useAccount();
  const [chain, setChain] = useState<(typeof CHAINS)[number]>("base");
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error, stop } = useChat();
  const bottom = useRef<HTMLDivElement>(null);
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [messages]);

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    sendMessage({ text }, { body: { wallet: address, chain } });
    setInput("");
  };

  return (
    <main className="mx-auto flex h-dvh max-w-3xl flex-col px-4">
      <header className="flex items-center gap-3 border-b border-zinc-800 py-3">
        <div className="text-lg font-semibold">
          <span className="bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">DeFi Agent</span>
        </div>
        <span className="hidden text-xs text-zinc-500 sm:inline">Aave V3 · you sign, it explains</span>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={chain}
            onChange={(e) => setChain(e.target.value as (typeof CHAINS)[number])}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm"
          >
            {CHAINS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <ConnectButton />
        </div>
      </header>

      <section className="flex-1 overflow-y-auto py-6">
        {messages.length === 0 && (
          <div className="mt-16 text-center">
            <h1 className="text-2xl font-semibold">Understand your DeFi risk in plain words.</h1>
            <p className="mt-2 text-sm text-zinc-400">
              Connect a wallet or paste any address. The agent reads Aave, simulates, and only ever <em>proposes</em>{" "}
              transactions.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-5">
          {messages.map((m) => (
            <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
              <div
                className={
                  m.role === "user"
                    ? "max-w-[85%] rounded-2xl bg-violet-600/80 px-4 py-2"
                    : "prose-chat max-w-full whitespace-pre-wrap text-[15px] leading-relaxed"
                }
              >
                {m.parts.map((p, i) => {
                  if (p.type === "text") return <span key={i}>{p.text}</span>;
                  if (p.type.startsWith("tool-")) return <ToolPart key={i} part={p as unknown as ToolPartLike} />;
                  return null;
                })}
              </div>
            </div>
          ))}
          {status === "submitted" && <div className="text-sm text-zinc-500">Thinking…</div>}
          {error && <div className="text-sm text-red-400">Something went wrong: {error.message}</div>}
        </div>
        <div ref={bottom} />
      </section>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-2 border-t border-zinc-800 py-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={address ? "Ask about your position…" : "Connect a wallet or paste an address…"}
          className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm outline-none focus:border-violet-500"
        />
        {busy ? (
          <button type="button" onClick={stop} className="rounded-xl border border-zinc-700 px-4 text-sm">
            Stop
          </button>
        ) : (
          <button type="submit" className="rounded-xl bg-violet-600 px-4 text-sm font-medium hover:bg-violet-500">
            Send
          </button>
        )}
      </form>
    </main>
  );
}
