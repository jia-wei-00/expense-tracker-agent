import { describe, expect, it } from "vitest";
import { SUPERSEDED_REASON, UNEXECUTED_REASON } from "@/constants/ai";
import {
  pendingApprovals,
  supersededMessage,
  unexecutedApprovals,
} from "@/services/ai/chat/approval.service";
import type { TChatMessage, TChatMessagePart } from "@/types/ai";

function assistantWith(parts: TChatMessagePart[]): TChatMessage {
  return { id: "msg-a", role: "assistant", parts };
}

const approvedUnexecuted: TChatMessagePart = {
  type: "tool-deleteExpense",
  toolCallId: "call-approved",
  state: "approval-responded",
  input: { ids: [7] },
  approval: { id: "approval-1", approved: true },
};

const pending: TChatMessagePart = {
  type: "tool-deleteExpense",
  toolCallId: "call-pending",
  state: "approval-requested",
  input: { ids: [8] },
  approval: { id: "approval-2" },
};

const done: TChatMessagePart = {
  type: "tool-deleteExpense",
  toolCallId: "call-done",
  state: "output-available",
  input: { ids: [9] },
  output: { ok: true, data: [{ id: 9 }] },
  approval: { id: "approval-3", approved: true },
};

describe("supersededMessage", () => {
  it("settles an approved call that never ran as output-denied", () => {
    const settled = supersededMessage(assistantWith([{ type: "text", text: "Deleting." }, approvedUnexecuted]));
    expect(settled.parts).toEqual([
      { type: "text", text: "Deleting." },
      {
        ...approvedUnexecuted,
        state: "output-denied",
        approval: { id: "approval-1", approved: false, reason: UNEXECUTED_REASON },
      },
    ]);
    expect(unexecutedApprovals(settled)).toEqual([]);
  });

  it("settles pending calls as superseded and leaves finished ones alone", () => {
    const settled = supersededMessage(assistantWith([done, pending]));
    expect(settled.parts).toEqual([
      done,
      {
        ...pending,
        state: "output-denied",
        approval: { id: "approval-2", approved: false, reason: SUPERSEDED_REASON },
      },
    ]);
    expect(pendingApprovals(settled)).toEqual([]);
  });
});

describe("unexecutedApprovals", () => {
  it("lists approved calls without output, only on assistant messages", () => {
    expect(unexecutedApprovals(assistantWith([done, approvedUnexecuted, pending]))).toEqual([approvedUnexecuted]);
    expect(unexecutedApprovals({ id: "u", role: "user", parts: [{ type: "text", text: "hi" }] })).toEqual([]);
    expect(unexecutedApprovals(undefined)).toEqual([]);
  });
});
