import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildRequest } from "../src/buildRequest";
import { loadDataset, startMock } from "./helpers";

const dataset = loadDataset();
let mock: Awaited<ReturnType<typeof startMock>>;
beforeAll(async () => {
  mock = await startMock(dataset);
});
afterAll(() => mock.close());

const SHA = "a".repeat(64);

function validRequest(): any {
  return buildRequest({ dataset, sessionId: "conv_neg_abc123", history: [], current: { text: "Am I eligible for PM-KISAN?" } });
}

function withImage(url: string, sha256 = SHA): any {
  const r = validRequest();
  r.message.input[0].content.push({ type: "image", attachment: { url, mediaType: "image/png", sha256 } });
  return r;
}

async function post(body: string | Uint8Array, headers: Record<string, string> = {}) {
  const res = await fetch(`${mock.baseUrl}/v1/turns`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
    body: body as BodyInit,
  });
  return { status: res.status, type: res.headers.get("content-type") ?? "", body: await res.text() };
}

describe("negative requests", () => {
  it("control: valid request is 200, also gzip-encoded", async () => {
    expect((await post(JSON.stringify(validRequest()))).status).toBe(200);
    expect((await post(gzipSync(JSON.stringify(validRequest())), { "Content-Encoding": "gzip" })).status).toBe(200);
  });

  const cases: Array<[string, () => any]> = [
    ["unknown top-level field", () => ({ ...validRequest(), extra: 1 })],
    ["unknown field in context", () => { const r = validRequest(); r.context.foo = "x"; return r; }],
    ["unknown field in attributes", () => { const r = validRequest(); r.message.attributes.streaming = true; return r; }],
    ["missing sessionId", () => { const r = validRequest(); delete r.context.sessionId; return r; }],
    ["wrong context.id", () => { const r = validRequest(); r.context.id = "api.dss.chat"; return r; }],
    ["bad channel", () => { const r = validRequest(); r.message.attributes.channel = "telegram"; return r; }],
    ["empty input", () => { const r = validRequest(); r.message.input = []; return r; }],
    ["bad role", () => { const r = validRequest(); r.message.input[0].role = "system"; return r; }],
    ["file content type", () => { const r = validRequest(); r.message.input[0].content.push({ type: "file", attachment: {} }); return r; }],
    ["lat/lon swapped out of range", () => { const r = validRequest(); r.message.attributes.location.geometry.coordinates = [19.99, 173.78]; return r; }],
    ["bad sha256 (uppercase)", () => withImage("http://localhost:5173/samples/tomato-leaf.png", "A".repeat(64))],
    ["bad sha256 (short)", () => withImage("http://localhost:5173/samples/tomato-leaf.png", "abc123")],
    ["non-allowlisted image host", () => withImage("https://evil.example.com/tomato-leaf.png")],
    ["bad image mediaType", () => { const r = withImage("http://localhost:5173/x.png"); r.message.input[0].content[1].attachment.mediaType = "image/gif"; return r; }],
  ];

  for (const [name, make] of cases) {
    it(`422: ${name}`, async () => {
      const res = await post(JSON.stringify(make()));
      expect(res.status, res.body).toBe(422);
      expect(res.type).toContain("application/problem+json");
      expect(JSON.parse(res.body)).toMatchObject({ status: 422 });
    });
  }

  it("400: malformed JSON", async () => {
    const res = await post('{"context": {"id": "api.dss.turn",');
    expect(res.status).toBe(400);
    expect(res.type).toContain("application/problem+json");
  });

  it("400: corrupt gzip body", async () => {
    const res = await post("not gzip", { "Content-Encoding": "gzip" });
    expect(res.status).toBe(400);
  });
});
