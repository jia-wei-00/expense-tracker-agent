import { describe, expect, it } from "vitest";
import { inboxStep, tombstoneCutoff, withinRunBudget } from "@/utils/inbox";

describe("inboxStep", () => {
  it("processes an update for its first three attempts", () => {
    expect(inboxStep(1)).toBe("process");
    expect(inboxStep(2)).toBe("process");
    expect(inboxStep(3)).toBe("process");
  });

  it("drops an update once it has failed three times", () => {
    expect(inboxStep(4)).toBe("drop");
    expect(inboxStep(9)).toBe("drop");
  });
});

describe("withinRunBudget", () => {
  const startedAt = 1_000_000;

  it("keeps going inside the 10 minute budget", () => {
    expect(withinRunBudget(startedAt, startedAt)).toBe(true);
    expect(withinRunBudget(startedAt, startedAt + 10 * 60 * 1000 - 1)).toBe(true);
  });

  it("stops once the budget is spent", () => {
    expect(withinRunBudget(startedAt, startedAt + 10 * 60 * 1000)).toBe(false);
  });
});

describe("tombstoneCutoff", () => {
  it("keeps processed updates for 24 hours", () => {
    const now = 1_000_000_000;
    expect(tombstoneCutoff(now)).toBe(now - 24 * 60 * 60 * 1000);
  });
});
