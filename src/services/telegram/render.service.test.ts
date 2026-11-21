import { describe, expect, it } from "vitest";
import { approvalCard, continuationOf } from "@/services/telegram/render.service";
import type { TChatMessage, TChatMessagePart } from "@/types/ai";
import type { TAddExpenseInput } from "@/types/ledger";

function assistantWith(parts: TChatMessagePart[]): TChatMessage {
  return { id: "msg-a", role: "assistant", parts };
}

function text(value: string): TChatMessagePart {
  return { type: "text", text: value };
}

const approval = { id: "approval-1" };

function pendingAdd(expenses: TAddExpenseInput[]): TChatMessage {
  return assistantWith([
    { type: "tool-addExpense", toolCallId: "call-add", state: "approval-requested", input: { expenses }, approval },
  ]);
}

function pendingDelete(ids: number[]): TChatMessage {
  return assistantWith([
    { type: "tool-deleteExpense", toolCallId: "call-del", state: "approval-requested", input: { ids }, approval },
  ]);
}

const lunch = { name: "Lunch at Hinz", amount: 48.5, category: 3, is_expense: true, spend_date: "2026-11-21T12:00:00" };
const salary = { name: "Salary", amount: 5000, category: 9, is_expense: false, spend_date: "2026-11-21T09:00:00" };
const categories = [
  { id: 3, name: "Food", is_expense: true },
  { id: 9, name: "Salary", is_expense: false },
];

describe("approvalCard", () => {
  it("approvalCard renders add rows with category names", () => {
    const msg = pendingAdd([{ name: "Lunch at Hinz", amount: 48.5, category: 3, is_expense: true, spend_date: "2026-11-21T12:00:00" }]);
    expect(approvalCard(msg, [{ id: 3, name: "Food", is_expense: true }])).toBe("Add 1 expense:\n• Lunch at Hinz — RM 48.50 (Food)");
  });

  it("approvalCard renders delete and returns undefined when nothing is pending", () => {
    expect(approvalCard(pendingDelete([12, 13]), [])).toBe("Delete expenses #12, #13");
    expect(approvalCard(assistantWith([text("hi")]), [])).toBeUndefined();
  });
});

describe("approvalCard details", () => {
  it("pluralises, marks income and falls back to the category id", () => {
    const msg = pendingAdd([lunch, salary, { ...lunch, category: 42 }]);
    expect(approvalCard(msg, categories)).toBe(
      [
        "Add 3 expenses:",
        "• Lunch at Hinz — RM 48.50 (Food)",
        "• Salary — RM 5000.00 income (Salary)",
        "• Lunch at Hinz — RM 48.50 (#42)",
      ].join("\n"),
    );
    expect(approvalCard(pendingDelete([7]), [])).toBe("Delete expense #7");
  });

  it("renders only the fields an update provides", () => {
    const msg = assistantWith([
      {
        type: "tool-updateExpense",
        toolCallId: "call-upd",
        state: "approval-requested",
        input: { id: 5, amount: 12, category: 3, is_expense: false },
        approval,
      },
    ]);
    expect(approvalCard(msg, categories)).toBe(
      "Update expense #5:\n• amount: RM 12.00\n• category: Food\n• type: income",
    );
  });

  it("ignores answered calls and joins several pending ones", () => {
    const answered: TChatMessagePart = {
      type: "tool-deleteExpense",
      toolCallId: "call-old",
      state: "output-denied",
      input: { ids: [1] },
      approval: { id: "approval-0", approved: false },
    };
    const [add] = pendingAdd([lunch]).parts;
    const [del] = pendingDelete([12]).parts;
    if (!add || !del) throw new Error("fixture");
    expect(approvalCard(assistantWith([answered, add, del]), categories)).toBe(
      "Add 1 expense:\n• Lunch at Hinz — RM 48.50 (Food)\n\nDelete expense #12",
    );
    expect(approvalCard(assistantWith([answered]), categories)).toBeUndefined();
  });
});

describe("continuationOf", () => {
  it("keeps only the parts a continuation added", () => {
    const before = assistantWith([text("Adding lunch."), ...pendingAdd([lunch]).parts]);
    const after = assistantWith([...before.parts, text("Saved.")]);
    expect(continuationOf(before, after).parts).toEqual([text("Saved.")]);
  });
});
