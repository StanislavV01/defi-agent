import { createConfig, http } from "wagmi";
import { arbitrum, base, mainnet, optimism, polygon } from "wagmi/chains";

export const wagmiConfig = createConfig({
  chains: [base, mainnet, arbitrum, optimism, polygon],
  // No explicit connectors: wagmi discovers installed wallets (MetaMask, Rabby…) via EIP-6963.
  transports: {
    [base.id]: http(),
    [mainnet.id]: http(),
    [arbitrum.id]: http(),
    [optimism.id]: http(),
    [polygon.id]: http(),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
