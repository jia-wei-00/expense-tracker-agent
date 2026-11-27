import { describe, expect, it } from "vitest";
import { TELEGRAM_COPY, TELEGRAM_MESSAGE_MAX } from "@/constants/telegram";
import {
  approvalCard,
  approvalState,
  cardTag,
  continuationOf,
  decidedCardText,
  replyOrFallback,
} from "@/services/telegram/render.service";
import { callsTag } from "@/utils/telegram";
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

describe("decidedCardText", () => {
  it("appends the decision once and never past Telegram's limit", () => {
    expect(decidedCardText("Delete expense #7", "Approved.")).toBe("Delete expense #7\n\nApproved.");
    expect(decidedCardText("Delete expense #7\n\nApproved.", "Approved.")).toBeUndefined();
    expect(decidedCardText(undefined, "Approved.")).toBeUndefined();
    const full = "x".repeat(TELEGRAM_MESSAGE_MAX - 5);
    expect(decidedCardText(full, "Rejected. Nothing saved.")).toBeUndefined();
  });
});

const input = { ids: [12] };
const requested: TChatMessagePart = {
  type: "tool-deleteExpense",
  toolCallId: "call-1",
  state: "approval-requested",
  input,
  approval: { id: "a-1" },
};
const responded: TChatMessagePart = {
  type: "tool-deleteExpense",
  toolCallId: "call-2",
  state: "approval-responded",
  input,
  approval: { id: "a-2", approved: true },
};
const executed: TChatMessagePart = {
  type: "tool-deleteExpense",
  toolCallId: "call-3",
  state: "output-available",
  input,
  output: { ok: true, data: [{ id: 12 }] },
  approval: { id: "a-3", approved: true },
};
const denied: TChatMessagePart = {
  type: "tool-deleteExpense",
  toolCallId: "call-4",
  state: "output-denied",
  input,
  approval: { id: "a-4", approved: false },
};

describe("approvalState", () => {
  it("is pending while any call waits for a decision", () => {
    expect(approvalState(assistantWith([requested, { ...requested, toolCallId: "call-5" }]))).toBe("pending");
  });

  it("is approved-unexecuted when approved calls have no output yet", () => {
    expect(approvalState(assistantWith([responded, { ...responded, toolCallId: "call-6" }]))).toBe("approved-unexecuted");
    expect(approvalState(assistantWith([executed, responded]))).toBe("approved-unexecuted");
  });

  it("cardTag binds a card to the calls it shows: pending ones, else the approved-unexecuted ones", () => {
    expect(cardTag(assistantWith([executed, requested, { ...requested, toolCallId: "call-5" }]))).toBe(
      callsTag(["call-1", "call-5"]),
    );
    expect(cardTag(assistantWith([executed, responded]))).toBe(callsTag(["call-2"]));
    expect(cardTag(assistantWith([executed, denied]))).toBeUndefined();
  });

  it("is settled once every call has an output or was denied", () => {
    expect(approvalState(assistantWith([executed, denied]))).toBe("settled");
    expect(approvalState(assistantWith([{ type: "text", text: "hi" }]))).toBe("settled");
    expect(approvalState(undefined)).toBe("settled");
  });
});

describe("replyOrFallback", () => {
  it("sends the reply text, or the fallback when there is neither text nor a card", () => {
    expect(replyOrFallback(assistantWith([text("Saved.")]))).toBe("Saved.");
    expect(replyOrFallback(assistantWith([]))).toBe(TELEGRAM_COPY.noReply);
    expect(replyOrFallback(undefined)).toBe("I couldn't produce a reply, please try again.");
  });

  it("stays empty when an approval card goes out instead", () => {
    expect(replyOrFallback(pendingDelete([7]))).toBe("");
  });
});
