import { describe, expect, it } from "vitest";
import { loadDataset } from "./helpers";

// The order the scenario list was asked for.
const GROUPS = ["Nested question", "Mandi", "Weather", "Scheme", "Grievance", "Agri advisory", "Fertilizer"];

describe("scenario order", () => {
  const dataset = loadDataset();

  it("every scenario has a group", () => {
    for (const s of dataset.scenarios) expect(s.group, s.id).toBeTruthy();
  });

  it("groups follow the requested order and each group is contiguous", () => {
    const seen: string[] = [];
    for (const s of dataset.scenarios) if (seen.at(-1) !== s.group) seen.push(s.group!);
    expect(seen).toEqual(GROUPS);
  });
});
