/**
 * Checks how messages of a conversation are answered: by a search, by picking
 * from the bands already found, or in words (TurnKind).
 *
 *     npm run routing -w services/eval [-- --repeat N]
 *
 * Asks the production router (agent/conversation/turnRouter.ts) with the
 * configured research model. A wrong "search" only costs time; a wrong "pick"
 * or "answer" gives the user the wrong thing, so both are reported apart.
 */
import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import type { ChatMessage, TurnKind } from "../../shared/schemas/src/contracts.js";
import { routeTurn } from "../api/src/agent/conversation/turnRouter.js";
import type { VerifiedCandidate } from "../api/src/agent/research/candidateVerifier.js";
import { resolveLlmConfig } from "../api/src/config/models.js";
import { createChatModelFactory } from "../api/src/llm/chatModel.js";

const here = dirname(fileURLToPath(import.meta.url));

type Band = { name: string; tags: string[]; listeners: number };
type RoutingConversation = {
  id: string;
  messages: ChatMessage[];
  shown: Band[][];
  unseen: Band[];
  turns: Array<{ message: string; expect: TurnKind[] }>;
};

const candidate = (b: Band): VerifiedCandidate => ({
  name: b.name,
  verified: true,
  evidenceUrls: [],
  evidenceSnippets: [],
  sourceQueries: [],
  mbTags: b.tags,
  listenerCount: b.listeners,
});

async function main(): Promise<void> {
  loadEnv({ path: join(here, "../../.env"), quiet: true });
  const { values: args } = parseArgs({ options: { repeat: { type: "string" } } });
  const repeat = Math.max(1, Number.parseInt(args.repeat ?? "1", 10) || 1);
  const llm = resolveLlmConfig(process.env);
  const model = createChatModelFactory(llm.research, llm)({ temperature: 0 });
  const conversations = JSON.parse(readFileSync(join(here, "turn-routing-set.json"), "utf8")) as RoutingConversation[];

  for (const conversation of conversations) {
    const latencies: number[] = [];
    let right = 0;
    let searchedNeedlessly = 0;
    let wrongAnswer = 0;
    for (let round = 0; round < repeat; round += 1) {
      for (const { message, expect } of conversation.turns) {
        const startedAt = Date.now();
        // As in production: no usable decision means a search.
        const turn = (await routeTurn(model, {
          query: message,
          messages: conversation.messages,
          shown: conversation.shown.map((bands) => bands.map(candidate)),
          unseen: conversation.unseen.map(candidate),
        }, { timeoutMs: 4000 }).catch(() => null)) ?? "search";
        latencies.push(Date.now() - startedAt);
        if (expect.includes(turn)) right += 1;
        else {
          if (turn === "search") searchedNeedlessly += 1;
          else wrongAnswer += 1;
          console.log(`  ✗ "${message}": ${turn}, expected ${expect.join(" or ")}`);
        }
      }
    }
    latencies.sort((a, b) => a - b);
    console.log(
      `${conversation.id}: ${right}/${latencies.length} right, ${wrongAnswer} answered wrongly, ` +
        `${searchedNeedlessly} searched needlessly, median ${latencies[Math.floor(latencies.length / 2)]} ms`,
    );
  }
}

await main();
