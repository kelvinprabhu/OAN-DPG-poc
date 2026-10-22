// Types and helpers for scenarios.json, shared by the mock server, the UI and the tests.
import type { Outcome, RequestAttributes, Source, TurnError } from "./contract";

export type DatasetContentItem =
  | { type: "openui"; lines: string[] }
  | { type: "refusal"; text: string }
  | { type: "text"; text: string };

export interface DatasetResponse {
  outcome: Outcome;
  historyText: string;
  openui?: string[];
  content?: DatasetContentItem[];
  sources: Source[];
  error?: TurnError;
}

export interface DatasetUser {
  text: string;
  formValues?: Record<string, string>;
  image?: string;
}

export interface DatasetTurn {
  /** user.text of the turn this one follows, when it is not the previous turn (a branch of a form tree). */
  from?: string;
  user: DatasetUser;
  response: DatasetResponse;
}

export interface Scenario {
  id: string;
  /** Heading the scenario is listed under in the UI. */
  group?: string;
  title: string;
  kind: string;
  uiPatterns: string[];
  attributes?: Partial<RequestAttributes>;
  turns: DatasetTurn[];
}

export interface Dataset {
  defaults: {
    requestVersion: string;
    responseVersion: string;
    userId: string;
    attributes: RequestAttributes;
    fallback: {
      outcome: Outcome;
      content: Array<{ type: "text" | "refusal"; text: string }>;
    };
  };
  scenarios: Scenario[];
}

/** The match key: the text before the first newline (form values follow on later lines). */
export function matchKey(text: string): string {
  return text.split("\n", 1)[0];
}

/** The scripted path: turns that follow the previous turn. Branches (`from`) are reached by interaction. */
export function mainTurns(scenario: Scenario): DatasetTurn[] {
  return scenario.turns.filter((t) => !t.from);
}

/** Turns from the first one to `turn`, following `from` links (else the previous turn). */
export function pathTo(scenario: Scenario, turn: DatasetTurn): DatasetTurn[] {
  const path: DatasetTurn[] = [turn];
  for (let cur = turn; ; ) {
    const i = scenario.turns.indexOf(cur);
    const parent = cur.from ? scenario.turns.find((t) => t.user.text === cur.from) : scenario.turns[i - 1];
    if (!parent) break;
    path.unshift(parent);
    cur = parent;
  }
  return path;
}

export function findTurn(dataset: Dataset, text: string): DatasetTurn | undefined {
  const key = matchKey(text);
  for (const s of dataset.scenarios) {
    for (const t of s.turns) if (t.user.text === key) return t;
  }
  return undefined;
}

/** Plain-text history for an assistant reply: the dataset historyText, or the fallback text. */
export function historyTextFor(dataset: Dataset, userText: string): string {
  const turn = findTurn(dataset, userText);
  if (turn) return turn.response.historyText;
  return dataset.defaults.fallback.content.map((c) => c.text).join("\n");
}

/** User message text: first line, then "key: value" lines for any form values. */
export function composeUserText(text: string, formValues?: Record<string, string>): string {
  const lines = Object.entries(formValues ?? {})
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${k}: ${v}`);
  return [text, ...lines].join("\n");
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) return (override ?? base) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

/** OpenUI Lang programs are carried in content[].text; detect them by their root statement. */
export function isOpenUI(text: string): boolean {
  return text.startsWith("root =") || text.includes("\nroot = ");
}
