import {
  applyAction,
  computeHealth,
  getAccount,
  getClient,
  getContracts,
  getMarkets,
  SUPPORTED_CHAINS,
  toSimPositions,
  type ChainName,
} from "defi-mcp";
import { encodeFunctionData, getAddress, maxUint256, parseAbi, parseUnits, type Address, type Hex } from "viem";

export type TxAction = "supply" | "withdraw" | "borrow" | "repay";

const poolWriteAbi = parseAbi([
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
  "function withdraw(address asset, uint256 amount, address to) returns (uint256)",
  "function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)",
  "function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)",
]);

const erc20Abi = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);

const VARIABLE_RATE = 2n;

export interface TxStep {
  label: string;
  to: Address;
  data: Hex;
  /** wei, as a decimal string (JSON-safe) */
  value: string;
}

export interface TxProposal {
  kind: "transaction-proposal";
  chain: ChainName;
  chainId: number;
  action: TxAction;
  symbol: string;
  amount: number;
  steps: TxStep[];
  healthFactor: { before: number | null; after: number | null };
  summary: string;
}

export function minHealthFactor(): number {
  const v = Number(process.env.MIN_HEALTH_FACTOR);
  return Number.isFinite(v) && v > 1 ? v : 1.3;
}

/** Decimal-safe conversion of a JS number to token units. */
function toUnits(amount: number, decimals: number): bigint {
  const fixed = amount.toFixed(Math.min(decimals, 20)).replace(/\.?0+$/, "");
  return parseUnits(fixed, decimals);
}

const fmtHf = (hf: number) => (Number.isFinite(hf) ? Math.round(hf * 1000) / 1000 : null);

/**
 * Build unsigned transactions for one Aave action, after policy checks.
 * Never signs or sends anything: the user signs each step in their wallet.
 */
export async function prepareAaveTx(params: {
  chain: ChainName;
  wallet: string;
  action: TxAction;
  symbol: string;
  amount: number;
}): Promise<TxProposal> {
  const { chain, action, amount } = params;
  const wallet = getAddress(params.wallet);
  if (!(amount > 0)) throw new Error("Amount must be greater than 0.");

  const [markets, account, { pool }] = await Promise.all([
    getMarkets(chain),
    getAccount(chain, wallet),
    getContracts(chain),
  ]);
  const market = markets.find((m) => m.symbol.toLowerCase() === params.symbol.toLowerCase());
  if (!market) throw new Error(`${params.symbol} is not an Aave V3 reserve on ${chain}.`);
  if (!market.isActive || market.isFrozen) throw new Error(`${market.symbol} reserve is not active right now.`);
  if (action === "borrow" && !market.borrowingEnabled) throw new Error(`Borrowing ${market.symbol} is disabled.`);

  // Policy: simulate first, refuse anything that leaves the position too close to liquidation.
  const positions = toSimPositions(account);
  const before = computeHealth(positions).healthFactor;
  const after = computeHealth(
    applyAction(positions, action, market.symbol, amount, {
      symbol: market.symbol,
      priceUsd: market.priceUsd,
      liquidationThreshold: market.canBeCollateral ? market.liquidationThreshold : 0,
    }),
  ).healthFactor;
  const minHf = minHealthFactor();
  if ((action === "borrow" || action === "withdraw") && after < minHf) {
    throw new Error(
      `Refused by safety policy: health factor would drop to ${fmtHf(after)} (minimum ${minHf}). ` +
        `Suggest a smaller amount or adding collateral first.`,
    );
  }

  const client = getClient(chain);
  const units = toUnits(amount, market.decimals);
  const steps: TxStep[] = [];

  if (action === "supply" || action === "repay") {
    const [balance, allowance] = await Promise.all([
      client.readContract({ address: market.address, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
      client.readContract({ address: market.address, abi: erc20Abi, functionName: "allowance", args: [wallet, pool] }),
    ]);
    if (balance < units) throw new Error(`Wallet holds less than ${amount} ${market.symbol}.`);
    if (allowance < units) {
      steps.push({
        label: `Approve ${amount} ${market.symbol} for Aave`,
        to: market.address,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [pool, units] }),
        value: "0",
      });
    }
  }

  const data: Hex = (() => {
    switch (action) {
      case "supply":
        return encodeFunctionData({ abi: poolWriteAbi, functionName: "supply", args: [market.address, units, wallet, 0] });
      case "withdraw": {
        const supplied = account.reserves.find((r) => r.address === market.address)?.supplied ?? 0;
        // Withdrawing (almost) everything → max uint so no dust is left behind.
        const all = amount >= supplied * 0.9999;
        return encodeFunctionData({ abi: poolWriteAbi, functionName: "withdraw", args: [market.address, all ? maxUint256 : units, wallet] });
      }
      case "borrow":
        return encodeFunctionData({ abi: poolWriteAbi, functionName: "borrow", args: [market.address, units, VARIABLE_RATE, 0, wallet] });
      case "repay":
        return encodeFunctionData({ abi: poolWriteAbi, functionName: "repay", args: [market.address, units, VARIABLE_RATE, wallet] });
    }
  })();

  const verb = { supply: "Supply", withdraw: "Withdraw", borrow: "Borrow", repay: "Repay" }[action];
  steps.push({ label: `${verb} ${amount} ${market.symbol}`, to: pool, data, value: "0" });

  return {
    kind: "transaction-proposal",
    chain,
    chainId: SUPPORTED_CHAINS[chain].chain.id,
    action,
    symbol: market.symbol,
    amount,
    steps,
    healthFactor: { before: fmtHf(before), after: fmtHf(after) },
    summary: `${verb} ${amount} ${market.symbol} on Aave V3 (${chain}). Health factor ${fmtHf(before) ?? "∞"} → ${fmtHf(after) ?? "∞"}.`,
  };
}
