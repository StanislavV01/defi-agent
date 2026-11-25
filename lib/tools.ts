import { tool } from "ai";
import {
  applyAction,
  CHAIN_NAMES,
  computeHealth,
  getAccount,
  getMarkets,
  liquidationPriceDrop,
  round,
  toSimPositions,
} from "defi-mcp";
import { z } from "zod";
import { prepareAaveTx } from "./tx";

const chain = z.enum(CHAIN_NAMES).describe("Network");
const action = z.enum(["supply", "withdraw", "borrow", "repay"]);

const hf = (v: number) => (Number.isFinite(v) ? round(v, 3) : null);

export function createTools(ctx: { wallet?: string }) {
  const resolve = (address?: string) => {
    const a = address ?? ctx.wallet;
    if (!a) throw new Error("No wallet connected and no address given. Ask the user to connect a wallet or paste an address.");
    return a;
  };

  return {
    getMarkets: tool({
      description: "List Aave V3 markets on a chain: price, supply/borrow APY (fractions), LTV, liquidation threshold, utilization.",
      inputSchema: z.object({
        chain,
        symbols: z.array(z.string()).optional().describe("Filter, e.g. ['USDC','WETH']"),
        limit: z.number().int().min(1).max(50).default(15),
      }),
      execute: async ({ chain, symbols, limit }) => {
        let markets = (await getMarkets(chain)).filter((m) => m.isActive);
        if (symbols?.length) {
          const s = new Set(symbols.map((x) => x.toLowerCase()));
          markets = markets.filter((m) => s.has(m.symbol.toLowerCase()));
        }
        markets.sort((a, b) => b.totalSupplied * b.priceUsd - a.totalSupplied * a.priceUsd);
        return markets.slice(0, limit).map((m) => ({
          symbol: m.symbol,
          priceUsd: m.priceUsd,
          supplyApy: m.supplyApy,
          borrowApy: m.variableBorrowApy,
          ltv: m.ltv,
          liquidationThreshold: m.liquidationThreshold,
          utilization: m.utilization,
          canBeCollateral: m.canBeCollateral,
          borrowingEnabled: m.borrowingEnabled && !m.isFrozen,
        }));
      },
    }),

    getAccount: tool({
      description:
        "Get an Aave V3 position: collateral, debt, health factor, net APY, per-asset breakdown and how far each collateral price can fall before liquidation. " +
        "Defaults to the connected wallet.",
      inputSchema: z.object({ chain, address: z.string().optional().describe("Defaults to the connected wallet") }),
      execute: async ({ chain, address }) => {
        const account = await getAccount(chain, resolve(address));
        const positions = toSimPositions(account);
        return {
          ...account,
          liquidationDrops: account.reserves
            .filter((r) => r.usedAsCollateral && r.supplied > 0)
            .map((r) => {
              const d = liquidationPriceDrop(positions, r.symbol);
              return { symbol: r.symbol, priceDropToLiquidation: d === null ? null : round(d, 4) };
            }),
        };
      },
    }),

    simulate: tool({
      description: "What-if: health factor after a sequence of actions. No transaction is sent. Always call before proposing a transaction.",
      inputSchema: z.object({
        chain,
        address: z.string().optional(),
        actions: z.array(z.object({ action, symbol: z.string(), amount: z.number().positive() })).min(1).max(10),
      }),
      execute: async ({ chain, address, actions }) => {
        const [account, markets] = await Promise.all([getAccount(chain, resolve(address)), getMarkets(chain)]);
        let positions = toSimPositions(account);
        const before = computeHealth(positions).healthFactor;
        const steps = actions.map((a) => {
          const m = markets.find((x) => x.symbol.toLowerCase() === a.symbol.toLowerCase());
          if (!m) throw new Error(`${a.symbol} is not an Aave reserve on ${chain}`);
          positions = applyAction(positions, a.action, m.symbol, a.amount, {
            symbol: m.symbol,
            priceUsd: m.priceUsd,
            liquidationThreshold: m.canBeCollateral ? m.liquidationThreshold : 0,
          });
          return { ...a, symbol: m.symbol, healthFactorAfter: hf(computeHealth(positions).healthFactor) };
        });
        return { before: hf(before), after: hf(computeHealth(positions).healthFactor), steps, note: "Estimate; eMode not modelled." };
      },
    }),

    proposeTransaction: tool({
      description:
        "Prepare unsigned transaction(s) for ONE Aave action for the connected wallet. The user reviews and signs them in their wallet; " +
        "you never send anything. Refused automatically if the resulting health factor is below the safety minimum.",
      inputSchema: z.object({ chain, action, symbol: z.string(), amount: z.number().positive() }),
      execute: async (input) => {
        if (!ctx.wallet) throw new Error("Connect a wallet first — transactions can only be prepared for the connected wallet.");
        return prepareAaveTx({ ...input, wallet: ctx.wallet });
      },
    }),
  };
}
