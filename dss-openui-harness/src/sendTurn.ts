// Sends one turn to POST {base}/v1/turns as JSON or SSE, reporting every frame received.
import type { TurnEvent, TurnRequest, TurnResponse } from "../shared/contract";

export interface SseFrame {
  event: string;
  data: string;
  parsed?: TurnEvent;
}

export interface SendOptions {
  baseUrl?: string;
  stream: boolean;
  gzip: boolean;
  fetchImpl?: typeof fetch;
  onFrame?: (frame: SseFrame) => void;
}

export interface SendResult {
  status: number;
  headers: Record<string, string>;
  requestHeaders: Record<string, string>;
  requestBody: string;
  /** Raw JSON body (JSON mode or error responses). */
  rawBody?: string;
  frames: SseFrame[];
  response?: TurnResponse;
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function gzipBytes(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Parse complete "event:/data:" blocks out of buf; returns the leftover partial block. */
export function parseSseChunk(buf: string, out: SseFrame[]): string {
  const blocks = buf.replace(/\r\n/g, "\n").split("\n\n");
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    if (!block.trim()) continue;
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    const frame: SseFrame = { event, data: data.join("\n") };
    try {
      frame.parsed = JSON.parse(frame.data);
    } catch {
      // keep raw data only
    }
    out.push(frame);
  }
  return rest;
}

export async function sendTurn(request: TurnRequest, opts: SendOptions): Promise<SendResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const requestBody = JSON.stringify(request, null, 2);
  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: opts.stream ? "text/event-stream" : "application/json",
    traceparent: `00-${randomHex(16)}-${randomHex(8)}-01`,
  };
  if (opts.gzip) requestHeaders["Content-Encoding"] = "gzip";
  const body = opts.gzip ? await gzipBytes(requestBody) : requestBody;

  const res = await fetchImpl(`${opts.baseUrl ?? ""}/v1/turns`, {
    method: "POST",
    headers: requestHeaders,
    body: body as BodyInit,
  });
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => (headers[k] = v));
  const result: SendResult = { status: res.status, headers, requestHeaders, requestBody, frames: [] };

  const isSse = (headers["content-type"] ?? "").includes("text/event-stream");
  if (!isSse || !res.body) {
    result.rawBody = await res.text();
    if (res.ok) result.response = JSON.parse(result.rawBody);
    return result;
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (value) {
      const before = result.frames.length;
      buf = parseSseChunk(buf + value, result.frames);
      for (const f of result.frames.slice(before)) opts.onFrame?.(f);
    }
    if (done) break;
  }
  if (buf.trim()) parseSseChunk(buf + "\n\n", result.frames);
  const terminal = result.frames.at(-1);
  if (terminal?.parsed && (terminal.event === "turn.completed" || terminal.event === "turn.failed")) {
    const { sequenceNumber: _seq, ...context } = terminal.parsed.context;
    result.response = { context, message: terminal.parsed.message } as TurnResponse;
  }
  return result;
}
