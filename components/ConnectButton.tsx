"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <button
        onClick={() => disconnect()}
        className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
        title="Disconnect"
      >
        🟢 {short(address)}
      </button>
    );
  }

  const wallet = connectors[0];
  return (
    <button
      disabled={!wallet || isPending}
      onClick={() => wallet && connect({ connector: wallet })}
      title={wallet ? `Connect ${wallet.name}` : "Install MetaMask or Rabby to connect"}
      className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium hover:bg-violet-500 disabled:opacity-50"
    >
      {isPending ? "Connecting…" : wallet ? `Connect ${wallet.name}` : "No wallet found"}
    </button>
  );
}
