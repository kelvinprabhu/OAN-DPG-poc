// Replays every scenario through the real request builder against the mock, in JSON and SSE modes.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TurnEvent, TurnRequest, TurnResponse } from "../shared/contract";
import { composeUserText, historyTextFor, pathTo } from "../shared/dataset";
import { buildRequest, imageAttachment, newSessionId, type HistoryEntry } from "../src/buildRequest";
import { sendTurn, type SendResult } from "../src/sendTurn";
import { loadDataset, publicFetch, startMock, UI_ORIGIN } from "./helpers";

const dataset = loadDataset();
let mock: Awaited<ReturnType<typeof startMock>>;
beforeAll(async () => {
  mock = await startMock(dataset);
});
afterAll(() => mock.close());

function checkSse(result: SendResult) {
  const { frames } = result;
  expect(result.headers["content-type"]).toContain("text/event-stream");
  expect(frames.length).toBeGreaterThanOrEqual(3);
  frames.forEach((f, i) => {
    const ev = TurnEvent.parse(f.parsed);
    expect(ev.context.sequenceNumber).toBe(i + 1);
  });
  expect(frames[0].event).toBe("turn.created");
  expect(frames[0].parsed?.message).toEqual({});
  const terminal = frames.at(-1)!;
  expect(terminal.event).toBe("turn.completed");
  expect(frames.filter((f) => f.event === "turn.completed")).toHaveLength(1);

  const message = TurnResponse.shape.message.parse(terminal.parsed!.message);
  const answered = message.outcome.status === "answered";

  // Walk the claims: deltas for item k, then claim.completed for item k.
  let pending = "";
  let deltaCount = 0;
  const completed: unknown[] = [];
  for (const f of frames.slice(1, -1)) {
    const item = f.parsed!.message.content![0];
    if (f.event === "claim.delta") {
      expect(item.type).toBe("output_text_delta");
      const len = Array.from(item.text).length;
      expect(len).toBeGreaterThanOrEqual(1);
      expect(len).toBeLessThanOrEqual(20);
      pending += item.text;
      deltaCount += 1;
    } else {
      expect(f.event).toBe("claim.completed");
      if (pending) expect(item.type === "text" && item.text).toBe(pending);
      if (answered && item.type === "text") expect(pending).toBe(item.text);
      pending = "";
      completed.push(item);
    }
  }
  expect(pending).toBe("");
  if (!answered) expect(deltaCount).toBe(0);
  else expect(deltaCount).toBeGreaterThan(0);
  expect(completed).toEqual(message.content);
  return message;
}

for (const stream of [false, true]) {
  describe(`contract conformance (${stream ? "SSE" : "JSON"})`, () => {
    for (const scenario of dataset.scenarios) {
      it(`${scenario.id}: ${scenario.title}`, async () => {
        const sessionId = newSessionId(scenario.id);
        expect(sessionId).toMatch(new RegExp(`^conv_${scenario.id}_[a-z0-9]{6}$`));
        for (const turn of scenario.turns) {
          // History = the turns on the way to this one (a branch replays its parent chain).
          const path = pathTo(scenario, turn);
          const history: HistoryEntry[] = [];
          for (const p of path.slice(0, -1)) {
            const pt = composeUserText(p.user.text, p.user.formValues);
            const pi = p.user.image ? await imageAttachment(p.user.image, UI_ORIGIN, publicFetch) : undefined;
            history.push({ role: "user", text: pt, image: pi }, { role: "assistant", text: historyTextFor(dataset, pt) });
          }
          const text = composeUserText(turn.user.text, turn.user.formValues);
          const image = turn.user.image ? await imageAttachment(turn.user.image, UI_ORIGIN, publicFetch) : undefined;
          const request = buildRequest({ dataset, scenario, sessionId, history, current: { text, image } });

          // Request side
          TurnRequest.parse(request);
          expect(request.message.input).toHaveLength((path.length - 1) * 2 + 1);
          expect(request.message.input.filter((m) => m.role === "assistant").every((m) => !m.content.some((c) => c.type === "text" && c.text.includes("root =")))).toBe(true);
          if (image) {
            expect(image.url).toBe(`${UI_ORIGIN}${turn.user.image}`);
            expect(request.message.input.at(-1)!.content[1]).toEqual({ type: "image", attachment: image });
          }

          const result = await sendTurn(request, { baseUrl: mock.baseUrl, stream, gzip: scenario.turns.indexOf(turn) % 2 === 1 });
          expect(result.status, result.rawBody).toBe(200);
          const response = TurnResponse.parse(result.response);
          if (stream) checkSse(result);

          expect(response.context.version).toBe(dataset.defaults.responseVersion);
          expect(response.context.sessionId).toBe(sessionId);
          expect(response.context.messageId).toBe(request.context.messageId);
          expect(response.context.traceId).toMatch(/^[0-9a-f]{32}$/);
          expect(result.requestHeaders.traceparent.split("-")[1]).toBe(response.context.traceId);
          expect(response.message.outcome).toHaveProperty("cause");
          expect(response.message.outcome).toEqual(turn.response.outcome);
          expect(response.message.sources).toEqual(turn.response.sources);
          if (turn.response.error) expect(response.message.error).toEqual(turn.response.error);
          if (turn.response.openui) {
            expect(response.message.content).toEqual([{ type: "text", text: turn.response.openui.join("\n"), annotations: [] }]);
          }

        }
      });
    }
  });
}

describe("fallback and wire details", () => {
  it("unmatched text returns defaults.fallback with cause present", async () => {
    for (const stream of [false, true]) {
      const request = buildRequest({ dataset, sessionId: "conv_free_abc123", history: [], current: { text: "What is the gold price?" } });
      const result = await sendTurn(request, { baseUrl: mock.baseUrl, stream, gzip: false });
      expect(result.status).toBe(200);
      const res = TurnResponse.parse(result.response);
      expect(res.message.outcome).toEqual(dataset.defaults.fallback.outcome);
      expect(res.message.content).toEqual(dataset.defaults.fallback.content);
      if (stream) expect(result.frames.some((f) => f.event === "claim.delta")).toBe(false);
    }
  });

  it("emits cause: null literally on the wire", async () => {
    const turn = dataset.scenarios[0].turns[0];
    const request = buildRequest({ dataset, scenario: dataset.scenarios[0], sessionId: "conv_S01_abc123", history: [], current: { text: turn.user.text } });
    const result = await sendTurn(request, { baseUrl: mock.baseUrl, stream: false, gzip: false });
    expect(result.rawBody).toContain('"cause":null');
  });

  it("falls back to transactionId (no dashes) as traceId without traceparent", async () => {
    const request = buildRequest({ dataset, sessionId: "conv_free_abc123", history: [], current: { text: "hello" } });
    const res = await fetch(`${mock.baseUrl}/v1/turns`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(request),
    });
    const body = TurnResponse.parse(await res.json());
    expect(body.context.traceId).toBe(request.context.transactionId.replace(/-/g, ""));
  });

  it("serves /health and /scenarios", async () => {
    expect(await (await fetch(`${mock.baseUrl}/health`)).json()).toEqual({ status: "ok" });
    expect(await (await fetch(`${mock.baseUrl}/scenarios`)).json()).toEqual(dataset);
  });
});
