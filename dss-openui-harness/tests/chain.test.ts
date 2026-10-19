// Turn n+1's user text must be one of the @ToAssistant messages in turn n's response.
import { describe, expect, it } from "vitest";
import { findTurn, type DatasetResponse } from "../shared/dataset";
import { loadDataset } from "./helpers";

const dataset = loadDataset();

function toAssistantMessages(r: DatasetResponse): string[] {
  const lines = [...(r.openui ?? []), ...(r.content ?? []).flatMap((c) => (c.type === "openui" ? c.lines : []))];
  return lines.flatMap((l) => [...l.matchAll(/@ToAssistant\("((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`)));
}

// Buttons with no scripted next turn: they must hit the fallback.
const INTENTIONALLY_UNMATCHED = [
  "None of these match",
  "पंजीकरण रद्द करें",
  "Start PM-KISAN registration",
  "ई-केवाईसी कैसे करें",
];

describe("chain check", () => {
  for (const s of dataset.scenarios) {
    it(`${s.id}: each next turn is a button in the previous response`, () => {
      for (let n = 1; n < s.turns.length; n++) {
        expect(toAssistantMessages(s.turns[n - 1].response)).toContain(s.turns[n].user.text);
      }
    });
  }

  it("intentionally unmatched buttons exist and hit the fallback", () => {
    const all = dataset.scenarios.flatMap((s) => s.turns.flatMap((t) => toAssistantMessages(t.response)));
    for (const text of INTENTIONALLY_UNMATCHED) {
      expect(all).toContain(text);
      expect(findTurn(dataset, text)).toBeUndefined();
    }
  });

  it("user texts are unique across scenarios (the mock returns the first match)", () => {
    const seen = new Map<string, string>();
    for (const s of dataset.scenarios)
      for (const t of s.turns) {
        expect(seen.get(t.user.text), `"${t.user.text}" in ${s.id} also used in ${seen.get(t.user.text)}`).toBeUndefined();
        seen.set(t.user.text, s.id);
      }
  });

  it("formValues keys match fields of the form in the previous response", () => {
    for (const s of dataset.scenarios)
      s.turns.forEach((t, n) => {
        if (!t.user.formValues) return;
        const prev = s.turns[n - 1];
        expect(prev, `${s.id} turn ${n + 1} has formValues but no previous turn`).toBeDefined();
        const lines = [...(prev.response.openui ?? []), ...(prev.response.content ?? []).flatMap((c) => (c.type === "openui" ? c.lines : []))].join("\n");
        for (const key of Object.keys(t.user.formValues)) {
          expect(lines, `${s.id} turn ${n + 1}: no field "${key}" in the previous form`).toMatch(new RegExp(`(Input|Select)\\("${key}"`));
        }
      });
  });

  it("lists every button that has no scripted turn", () => {
    const dangling = dataset.scenarios.flatMap((s) =>
      s.turns.flatMap((t) => toAssistantMessages(t.response).filter((m) => !findTurn(dataset, m)).map((m) => `${s.id}: ${m}`)),
    );
    console.info(`Buttons that fall back (no scripted turn):\n  ${dangling.join("\n  ")}`);
    expect(dangling.length).toBeGreaterThanOrEqual(INTENTIONALLY_UNMATCHED.length);
  });
});
