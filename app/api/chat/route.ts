import { anthropic } from "@ai-sdk/anthropic";
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";
import { CHAIN_NAMES } from "defi-mcp";
import { isAddress } from "viem";
import { systemPrompt } from "@/lib/prompt";
import { createTools } from "@/lib/tools";

export const maxDuration = 60;

export async function POST(req: Request) {
  const body = (await req.json()) as { messages: UIMessage[]; wallet?: string; chain?: string };
  const wallet = body.wallet && isAddress(body.wallet) ? body.wallet : undefined;
  const chain = CHAIN_NAMES.find((c) => c === body.chain) ?? "base";

  const result = streamText({
    model: anthropic(process.env.MODEL || "claude-sonnet-5-5"),
    system: systemPrompt({ wallet, chain }),
    messages: convertToModelMessages(body.messages),
    tools: createTools({ wallet }),
    stopWhen: stepCountIs(8),
  });

  return result.toUIMessageStreamResponse();
}
