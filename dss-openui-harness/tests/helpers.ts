import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../server/app";
import type { Dataset } from "../shared/dataset";

// Vitest runs from the project root; jsdom changes import.meta.url, so use paths.
export const ROOT = process.cwd();
export const fromRoot = (...parts: string[]) => resolve(ROOT, ...parts);
export const UI_ORIGIN = "http://localhost:5173";

export function loadDataset(): Dataset {
  return JSON.parse(readFileSync(fromRoot("scenarios.json"), "utf8")) as Dataset;
}

export async function startMock(dataset = loadDataset()): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server: Server = await new Promise((resolve) => {
    const s = createApp({ dataset, deltaDelayMs: 1 }).listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

/** Stands in for the Vite dev server: serves public/ for image hashing. */
export const publicFetch: typeof fetch = async (input) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  try {
    return new Response(readFileSync(fromRoot("public" + url.pathname)));
  } catch {
    return new Response("not found", { status: 404 });
  }
};
