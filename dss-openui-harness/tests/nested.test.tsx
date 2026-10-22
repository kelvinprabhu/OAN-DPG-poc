// @vitest-environment jsdom
// S14 / S15: nested questions appear in order, and answers reach onAction.
import { Renderer, type ActionEvent } from "@openuidev/react-lang";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { agriLibrary } from "../src/library";
import { loadDataset } from "./helpers";

const dataset = loadDataset();
const program = (id: string, turn = 0) => dataset.scenarios.find((s) => s.id === id)!.turns[turn].response.openui!.join("\n");

afterEach(cleanup);

function setup(id: string) {
  const events: ActionEvent[] = [];
  const view = render(<Renderer library={agriLibrary} response={program(id)} isStreaming={false} onAction={(e) => events.push(e)} />);
  const questions = () => Array.from(view.container.querySelectorAll(".ou-label")).map((l) => l.textContent);
  // Choose an option inside one question (each FormControl is a labelled group).
  const pick = (question: string, option: RegExp) =>
    fireEvent.click(within(screen.getByRole("group", { name: question })).getByRole("radio", { name: option }));
  return { events, questions, pick };
}

describe("S14 livestock nested questions", () => {
  it("cattle: herd size, then collar, then collar call, then the reason", () => {
    const { events, questions, pick } = setup("S14");
    expect(questions()).toEqual(["What do you keep?"]);
    pick("What do you keep?", /Cattle/);
    expect(questions()).toEqual(["What do you keep?", "How many animals do you have?"]);
    pick("How many animals do you have?", /6 to 20/);
    expect(questions().at(-1)).toBe("Do your animals wear a health collar?");
    pick("Do your animals wear a health collar?", /^Yes/);
    expect(questions().at(-1)).toBe("Has the collar called you in the last 3 days?");
    expect(screen.queryByRole("button", { name: "Get cattle advice" })).not.toBeNull();
    pick("Has the collar called you in the last 3 days?", /^Yes/); // nested yes/no
    expect(questions().at(-1)).toBe("What did the call say?");
    pick("What did the call say?", /Ready for insemination/);

    fireEvent.click(screen.getByRole("button", { name: "Get cattle advice" }));
    expect(events).toHaveLength(1);
    expect(events[0].humanFriendlyMessage).toBe("Get cattle advice");
    // Answers bound to $variables arrive in formState keyed "$name".
    expect(events[0].formState).toMatchObject({
      $animal: "Cattle",
      $cattle_herd: "6 to 20",
      $collar: "Yes",
      $collar_called: "Yes",
      $collar_reason: "Ready for insemination",
    });
  });

  it("cattle without a collar sees the collar hint instead of the collar questions", () => {
    const { questions, pick } = setup("S14");
    pick("What do you keep?", /Cattle/);
    pick("How many animals do you have?", /1 to 5/);
    pick("Do your animals wear a health collar?", /^No/);
    expect(questions()).not.toContain("Has the collar called you in the last 3 days?");
    expect(document.body.textContent).toContain("Ask your project team how to get one");
  });

  it("changing the animal hides the cattle questions and shows the poultry ones", () => {
    const { questions, pick } = setup("S14");
    pick("What do you keep?", /Cattle/);
    pick("How many animals do you have?", /6 to 20/);
    pick("What do you keep?", /Poultry/);
    expect(questions()).toEqual(["What do you keep?", "How many birds?"]);
    pick("How many birds?", /51 to 200/);
    pick("Have any birds died suddenly this week?", /^Yes/);
    expect(questions().at(-1)).toBe("Are more than 5 birds affected?");
    pick("Are more than 5 birds affected?", /^Yes/);
    expect(document.body.textContent).toContain("call the animal doctor today");
  });
});

describe("S14 hidden answers", () => {
  it("answers of a hidden branch are cleared, so poultry advice carries no cattle answers", () => {
    const { events, pick } = setup("S14");
    pick("What do you keep?", /Cattle/);
    pick("How many animals do you have?", /6 to 20/);
    pick("Do your animals wear a health collar?", /^Yes/);
    pick("What do you keep?", /Poultry/);
    pick("How many birds?", /1 to 50/);
    pick("Have any birds died suddenly this week?", /^No/);
    fireEvent.click(screen.getByRole("button", { name: "Get poultry advice" }));
    const state = events[0].formState as Record<string, unknown>;
    expect(state).toMatchObject({ $animal: "Poultry", $poultry_flock: "1 to 50", $sudden_deaths: "No" });
    expect(state.$cattle_herd).toBe("");
    expect(state.$collar).toBe("");
  });

  it("going back to cattle starts the cattle questions again", () => {
    const { questions, pick } = setup("S14");
    pick("What do you keep?", /Cattle/);
    pick("How many animals do you have?", /6 to 20/);
    pick("What do you keep?", /Goats/);
    pick("What do you keep?", /Cattle/);
    expect(questions()).toEqual(["What do you keep?", "How many animals do you have?"]);
    expect(screen.queryByRole("radio", { name: /6 to 20/, checked: true })).toBeNull();
  });
});

describe("S15 grievance form", () => {
  it("blocks a too-short description, then sends category, details and date", () => {
    const events: ActionEvent[] = [];
    const { container } = render(<Renderer library={agriLibrary} response={program("S15")} isStreaming={false} onAction={(e) => events.push(e)} />);
    fireEvent.click(screen.getByText("Payment not received"));
    fireEvent.change(container.querySelector("textarea")!, { target: { value: "short" } });
    fireEvent.change(container.querySelector("input[type=date]")!, { target: { value: "2026-10-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit complaint" }));
    expect(events).toEqual([]); // minLength 10 not met

    fireEvent.change(container.querySelector("textarea")!, { target: { value: "Second instalment not credited." } });
    fireEvent.click(screen.getByRole("button", { name: "Submit complaint" }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ humanFriendlyMessage: "Submit my complaint", formName: "grievance" });
    const form = events[0].formState!.grievance as Record<string, { value: unknown }>;
    expect(form.details.value).toBe("Second instalment not credited.");
    expect(form.incident_date.value).toBe("2026-10-10");
    expect(String(form.category.value)).toContain("payment");
  });
});
