// Builds the exact DSS turn request envelope for one send.
import type { ImageAttachment, InputMessage, TurnRequest } from "../shared/contract";
import { deepMerge, type Dataset, type Scenario } from "../shared/dataset";

/** One prior message. Assistant entries carry historyText, never OpenUI source. */
export interface HistoryEntry {
  role: "user" | "assistant";
  text: string;
  image?: ImageAttachment;
}

export interface BuildRequestArgs {
  dataset: Dataset;
  scenario?: Scenario;
  sessionId: string;
  history: HistoryEntry[];
  current: { text: string; image?: ImageAttachment };
}

function toInput(e: HistoryEntry): InputMessage {
  const content: InputMessage["content"] = [{ type: "text", text: e.text }];
  if (e.image) content.push({ type: "image", attachment: e.image });
  return { role: e.role, content };
}

export function buildRequest({ dataset, scenario, sessionId, history, current }: BuildRequestArgs): TurnRequest {
  const { defaults } = dataset;
  return {
    context: {
      id: "api.dss.turn",
      version: defaults.requestVersion,
      timestamp: new Date().toISOString(),
      sessionId,
      transactionId: crypto.randomUUID(),
      messageId: crypto.randomUUID(),
    },
    message: {
      userContext: [{ type: "identity", userId: defaults.userId }],
      attributes: deepMerge(defaults.attributes, scenario?.attributes ?? {}),
      input: [...history, { role: "user" as const, ...current }].map(toInput),
    },
  };
}

/** Absolute URL, mediaType and sha256 (computed from the fetched bytes) for an image path. */
export async function imageAttachment(
  path: string,
  origin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ImageAttachment> {
  const url = new URL(path, origin).toString();
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Could not fetch ${url}: HTTP ${res.status}`);
  const digest = await crypto.subtle.digest("SHA-256", await res.arrayBuffer());
  const sha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return { url, mediaType: "image/png", sha256 };
}

export function newSessionId(scenarioId: string): string {
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
  return `conv_${scenarioId}_${rand}`;
}
