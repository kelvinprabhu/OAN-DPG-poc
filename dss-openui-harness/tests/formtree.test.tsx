// @vitest-environment jsdom
// S13: choosing a scheme swaps in that scheme's form, entirely inside the renderer.
import { Renderer, type ActionEvent } from "@openuidev/react-lang";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { agriLibrary } from "../src/library";
import { loadDataset } from "./helpers";

const dataset = loadDataset();
const tree = dataset.scenarios.find((s) => s.id === "S13")!.turns[0].response.openui!.join("\n");

afterEach(cleanup);

const forms = [
  { button: /PM-KISAN: income support/, form: "elig_pmkisan", submit: "Check PM-KISAN eligibility" },
  { button: /PMFBY: crop insurance/, form: "elig_pmfby", submit: "Check PMFBY eligibility" },
  { button: /Kisan Credit Card: farm loan/, form: "elig_kcc", submit: "Check Kisan Credit Card eligibility" },
  { button: /PM-KUSUM: solar pump/, form: "elig_kusum", submit: "Check PM-KUSUM eligibility" },
];

describe("S13 form tree", () => {
  it("starts with the PM-KISAN form selected and no server call", () => {
    const events: ActionEvent[] = [];
    render(<Renderer library={agriLibrary} response={tree} isStreaming={false} onAction={(e) => events.push(e)} />);
    expect(screen.getAllByRole("form")).toHaveLength(1);
    expect(screen.getByRole("form").getAttribute("aria-label")).toBe("elig_pmkisan");
    expect(events).toEqual([]);
  });

  for (const f of forms) {
    it(`choosing ${f.form} shows only that form and sends its own message`, () => {
      const events: ActionEvent[] = [];
      render(<Renderer library={agriLibrary} response={tree} isStreaming={false} onAction={(e) => events.push(e)} />);
      fireEvent.click(screen.getByRole("button", { name: f.button }));
      expect(screen.getAllByRole("form").map((x) => x.getAttribute("aria-label"))).toEqual([f.form]);
      // Choosing a scheme is local state: nothing reaches onAction.
      expect(events).toEqual([]);

      // Fill every field of the visible form, then submit.
      const form = screen.getByRole("form");
      for (const input of Array.from(form.querySelectorAll("input"))) {
        fireEvent.change(input, { target: { value: input.type === "date" ? "2026-11-20" : "1.5" } });
      }
      for (const select of Array.from(form.querySelectorAll("select"))) {
        fireEvent.change(select, { target: { value: select.options[1].value } });
      }
      fireEvent.click(screen.getByRole("button", { name: "Check eligibility" }));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: "continue_conversation", humanFriendlyMessage: f.submit, formName: f.form });
      expect(Object.keys(events[0].formState ?? {})).toEqual([f.form]);
    });
  }

  it("highlights the chosen scheme button", () => {
    render(<Renderer library={agriLibrary} response={tree} isStreaming={false} />);
    fireEvent.click(screen.getByRole("button", { name: /PMFBY: crop insurance/ }));
    const primary = Array.from(document.querySelectorAll(".ou-button--primary")).map((b) => b.textContent);
    expect(primary).toContain("PMFBY: crop insurance");
    expect(primary).not.toContain("PM-KISAN: income support");
  });
});
