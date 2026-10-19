// Mock DSS: POST /v1/turns answered from scenarios.json. No LLM, no keys.
import { randomBytes } from "node:crypto";
import express, { type ErrorRequestHandler, type Request, type Response } from "express";
import { z } from "zod/v4";
import { TurnRequest, type ResponseContent, type TurnResponse } from "../shared/contract";
import { findTurn, type Dataset, type DatasetResponse } from "../shared/dataset";

export interface MockOptions {
  dataset: Dataset;
  /** Hostnames allowed in image attachment URLs. */
  allowedImageHosts?: string[];
  /** Delay between SSE frames that carry claim.delta, in ms. */
  deltaDelayMs?: number;
}

const TRACEPARENT = /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/;

function problem(res: Response, status: number, title: string, detail: string, extra: object = {}) {
  res
    .status(status)
    .type("application/problem+json")
    .send(JSON.stringify({ type: "about:blank", title, status, detail, ...extra }));
}

/** traceparent trace id, else the transactionId as 32 hex (openapi.yaml), else random. */
function traceIdFor(req: Request, transactionId: string): string {
  const m = TRACEPARENT.exec(String(req.header("traceparent") ?? ""));
  if (m && !/^0+$/.test(m[1])) return m[1];
  const hex = transactionId.replace(/-/g, "").toLowerCase();
  if (/^[0-9a-f]{32}$/.test(hex)) return hex;
  return randomBytes(16).toString("hex");
}

/** Dataset response -> contract message.content items. */
export function toContent(r: Pick<DatasetResponse, "openui" | "content">): ResponseContent[] {
  if (r.openui) return [{ type: "text", text: r.openui.join("\n"), annotations: [] }];
  return (r.content ?? []).map((c) =>
    c.type === "openui" ? { type: "text", text: c.lines.join("\n"), annotations: [] } : c,
  );
}

/** Split into 8-20 character pieces (by code point), ignoring word and number boundaries. */
export function splitDeltas(text: string): string[] {
  const chars = Array.from(text);
  const pieces: string[] = [];
  for (let i = 0; i < chars.length; ) {
    const n = 8 + Math.floor(Math.random() * 13);
    pieces.push(chars.slice(i, i + n).join(""));
    i += n;
  }
  return pieces;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createApp(opts: MockOptions) {
  const { dataset } = opts;
  const allowedHosts = new Set(opts.allowedImageHosts ?? ["localhost", "127.0.0.1"]);
  const deltaDelayMs = opts.deltaDelayMs ?? 40;

  const app = express();
  // body-parser inflates Content-Encoding: gzip by default.
  app.use("/v1", express.json({ limit: "2mb", strict: false }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/scenarios", (_req, res) => {
    res.json(dataset);
  });

  app.post("/v1/turns", async (req, res) => {
    if (req.body === undefined) {
      return problem(res, 400, "Bad Request", "Content-Type must be application/json with a JSON body.");
    }
    const parsed = TurnRequest.safeParse(req.body);
    if (!parsed.success) {
      return problem(res, 422, "Unprocessable Entity", "Request violates the DSS turn contract.", {
        errors: z.treeifyError(parsed.error),
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const body = parsed.data;

    for (const m of body.message.input) {
      for (const c of m.content) {
        if (c.type !== "image") continue;
        const host = new URL(c.attachment.url).hostname;
        if (!allowedHosts.has(host)) {
          return problem(res, 422, "Unprocessable Entity", `Attachment host "${host}" is not on the allowlist.`);
        }
      }
    }

    const lastUser = [...body.message.input].reverse().find((m) => m.role === "user");
    const text = lastUser?.content.find((c) => c.type === "text");
    const turn = text?.type === "text" ? findTurn(dataset, text.text) : undefined;

    const message: TurnResponse["message"] = turn
      ? {
          outcome: { ...turn.response.outcome, cause: turn.response.outcome.cause ?? null },
          content: toContent(turn.response),
          sources: turn.response.sources ?? [],
          ...(turn.response.error ? { error: turn.response.error } : {}),
        }
      : {
          outcome: { ...dataset.defaults.fallback.outcome, cause: dataset.defaults.fallback.outcome.cause ?? null },
          content: dataset.defaults.fallback.content.map((c) => ({ ...c })),
          sources: [],
        };

    const baseContext = {
      id: "api.dss.turn" as const,
      version: dataset.defaults.responseVersion,
      messageId: body.context.messageId ?? `msg_${randomBytes(8).toString("hex")}`,
      sessionId: body.context.sessionId,
      traceId: traceIdFor(req, body.context.transactionId),
    };

    const accept = String(req.header("accept") ?? "");
    if (!accept.includes("text/event-stream")) {
      const response: TurnResponse = {
        context: { ...baseContext, timestamp: new Date().toISOString() },
        message,
      };
      return res.status(200).json(response);
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    let closed = false;
    res.on("close", () => (closed = true));
    let seq = 0;
    const send = (event: string, msg: object) => {
      if (closed) return;
      seq += 1;
      const data = {
        context: { ...baseContext, timestamp: new Date().toISOString(), sequenceNumber: seq },
        message: msg,
      };
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send("turn.created", {});
    // Only a composed answer streams; fixed replies carry no claim.delta.
    const streams = message.outcome.status === "answered";
    for (const item of message.content) {
      if (streams && item.type === "text") {
        for (const piece of splitDeltas(item.text)) {
          if (closed) return;
          await sleep(deltaDelayMs);
          send("claim.delta", { content: [{ type: "output_text_delta", text: piece }] });
        }
      }
      send("claim.completed", { content: [item] });
    }
    send("turn.completed", message);
    res.end();
  });

  const onError: ErrorRequestHandler = (err, _req, res, next) => {
    if (res.headersSent) return next(err);
    const status = typeof err?.status === "number" ? err.status : 500;
    if (status === 400 || err?.type === "entity.parse.failed") {
      return problem(res, 400, "Bad Request", `Malformed request body: ${err.message}`);
    }
    if (status === 415) return problem(res, 400, "Bad Request", err.message);
    return problem(res, status, "Error", String(err?.message ?? err));
  };
  app.use(onError);

  return app;
}
