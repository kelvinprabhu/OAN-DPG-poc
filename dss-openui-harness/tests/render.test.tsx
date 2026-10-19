// @vitest-environment jsdom
// Every OpenUI program in the dataset must parse and render with no errors and no undefined references.
import { existsSync } from "node:fs";
import { createParser, Renderer, type OpenUIError } from "@openuidev/react-lang";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { agriLibrary } from "../src/library";
import { fromRoot, loadDataset } from "./helpers";

const dataset = loadDataset();

const programs: Array<[string, string]> = [];
for (const s of dataset.scenarios) {
  s.turns.forEach((t, i) => {
    if (t.response.openui) programs.push([`${s.id} turn ${i + 1}`, t.response.openui.join("\n")]);
    t.response.content?.forEach((c, j) => {
      if (c.type === "openui") programs.push([`${s.id} turn ${i + 1} item ${j + 1}`, c.lines.join("\n")]);
    });
  });
}

afterEach(cleanup);

describe("OpenUI render check", () => {
  it("found every program", () => {
    const expected = dataset.scenarios.flatMap((s) => s.turns).reduce(
      (n, t) => n + (t.response.openui ? 1 : 0) + (t.response.content?.filter((c) => c.type === "openui").length ?? 0),
      0,
    );
    expect(programs).toHaveLength(expected);
    expect(programs.length).toBeGreaterThan(40);
  });

  for (const [name, text] of programs) {
    it(name, () => {
      const parsed = createParser(agriLibrary.toJSONSchema(), "Stack").parse(text);
      expect(parsed.meta.unresolved, "undefined identifiers").toEqual([]);
      expect(parsed.meta.orphaned, "unreachable statements").toEqual([]);
      expect(parsed.meta.errors, "validation errors").toEqual([]);
      expect(parsed.meta.incomplete).toBe(false);
      expect(parsed.root?.typeName).toBe("Stack");

      const errors: OpenUIError[] = [];
      const { container } = render(
        <Renderer library={agriLibrary} response={text} isStreaming={false} onError={(e) => errors.push(...e)} />,
      );
      expect(errors).toEqual([]);
      expect(container.textContent?.length).toBeGreaterThan(0);

      // A Map draws one list entry per MapMarker, besides the Leaflet canvas.
      if (/= Map\(/.test(text)) {
        expect(container.querySelector(".leaflet-container")).not.toBeNull();
        expect(container.querySelectorAll(".ou-map-list li").length).toBe((text.match(/= MapMarker\(/g) ?? []).length);
      }

      for (const img of Array.from(container.querySelectorAll("img"))) {
        const src = img.getAttribute("src")!;
        if (!src.startsWith("/")) continue; // remote map tiles
        expect(existsSync(fromRoot("public" + src)), `missing image ${src}`).toBe(true);
      }
    });
  }

  it("every image src in the dataset resolves", () => {
    const srcs = new Set<string>();
    for (const s of dataset.scenarios)
      for (const t of s.turns) {
        if (t.user.image) srcs.add(t.user.image);
        const lines = [...(t.response.openui ?? []), ...(t.response.content ?? []).flatMap((c) => (c.type === "openui" ? c.lines : []))];
        for (const l of lines) for (const m of l.matchAll(/ImageCard\("([^"]+)"/g)) srcs.add(m[1]);
      }
    expect(srcs.size).toBeGreaterThan(10);
    for (const src of srcs) expect(existsSync(fromRoot("public" + src)), src).toBe(true);
  });
});
