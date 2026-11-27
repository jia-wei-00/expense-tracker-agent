import { describe, expect, it } from "vitest";
import { readReply } from "@/services/ai/chat/run.service";
import { cardContinuation, saveOnceRun } from "@/services/telegram/continuation.service";
import { cardTag } from "@/services/telegram/render.service";
import type { TChatMessage, TChatMessagePart } from "@/types/ai";
import { callsTag } from "@/utils/telegram";
import type { UIMessageChunk } from "ai";

function assistantWith(parts: TChatMessagePart[]): TChatMessage {
  return { id: "msg-a", role: "assistant", parts };
}

function deleteCall(
  toolCallId: string,
  state: "approval-requested" | "approval-responded" | "output-available" | "output-denied",
): TChatMessagePart {
  const base = { type: "tool-deleteExpense" as const, toolCallId, input: { ids: [7] } };
  const approvalId = `ap-${toolCallId}`;
  switch (state) {
    case "approval-requested":
      return { ...base, state, approval: { id: approvalId } };
    case "approval-responded":
      return { ...base, state, approval: { id: approvalId, approved: true } };
    case "output-available":
      return { ...base, state, output: { ok: true, data: [{ id: 7 }] }, approval: { id: approvalId, approved: true } };
    case "output-denied":
      return { ...base, state, approval: { id: approvalId, approved: false, reason: "no" } };
  }
  return state satisfies never;
}

function chunkStream(chunks: UIMessageChunk[]): ReadableStream<UIMessageChunk> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

/** A save that records what it stored, after a tick like a real write. */
function recordingSave() {
  const saved: TChatMessage[] = [];
  const save = async (message: TChatMessage) => {
    await Promise.resolve();
    saved.push(message);
  };
  return { saved, save };
}

describe("approval continuation that fails after the write", () => {
  it("stores the snapshot with the tool output before the model error throws", async () => {
    const before = assistantWith([{ type: "text", text: "Deleting #7." }, deleteCall("c1", "approval-responded")]);
    const { saved, save } = recordingSave();
    // What the agent streams when the approved tool runs and the model call after it fails.
    const stream = chunkStream([
      { type: "start", messageId: "msg-a" },
      { type: "tool-output-available", toolCallId: "c1", output: { ok: true, data: [{ id: 7 }] } },
      { type: "start-step" },
      { type: "error", errorText: "both providers down" },
    ]);

    await expect(readReply({ stream, message: before, onSnapshot: saveOnceRun(before, save) })).rejects.toThrow(
      "both providers down",
    );
    expect(saved).toHaveLength(1);
    expect(saved[0]?.parts[1]).toMatchObject({ toolCallId: "c1", state: "output-available" });
    // A retry finds the calls settled (no `approved-unexecuted` tag), so the tool does not run again.
    expect(cardTag(saved[0])).toBeUndefined();
    // The SDK grows the message it is given in place; the caller's copy must not change.
    expect(before.parts).toHaveLength(2);
  });
});

describe("saveOnceRun", () => {
  it("waits until every approved call has run, then saves once", async () => {
    const before = assistantWith([deleteCall("c1", "approval-responded"), deleteCall("c2", "approval-responded")]);
    const { saved, save } = recordingSave();
    const onSnapshot = saveOnceRun(before, save);
    await onSnapshot(assistantWith([deleteCall("c1", "output-available"), deleteCall("c2", "approval-responded")]));
    expect(saved).toHaveLength(0);
    const ran = assistantWith([deleteCall("c1", "output-available"), deleteCall("c2", "output-available")]);
    await onSnapshot(ran);
    await onSnapshot(assistantWith([...ran.parts, { type: "text", text: "Done." }]));
    expect(saved).toEqual([ran]);
  });
});

describe("cardContinuation", () => {
  const tag = callsTag(["c1"]);
  const card: TChatMessagePart[] = [{ type: "step-start" }, { type: "text", text: "Deleting #7." }];

  it("is what the run added after the approved card's step", () => {
    const message = assistantWith([
      ...card,
      deleteCall("c1", "output-available"),
      { type: "step-start" },
      { type: "text", text: "Deleted." },
      deleteCall("c2", "approval-requested"),
    ]);
    expect(cardContinuation(message, tag)?.parts).toEqual([
      { type: "step-start" },
      { type: "text", text: "Deleted." },
      deleteCall("c2", "approval-requested"),
    ]);
  });

  it("is empty when the calls ran but the answer was never generated", () => {
    expect(cardContinuation(assistantWith([...card, deleteCall("c1", "output-available")]), tag)?.parts).toEqual([]);
  });

  it("is undefined for a rejected, still-unrun or unknown card", () => {
    expect(cardContinuation(assistantWith([...card, deleteCall("c1", "output-denied")]), tag)).toBeUndefined();
    expect(cardContinuation(assistantWith([...card, deleteCall("c1", "approval-responded")]), tag)).toBeUndefined();
    const ran = assistantWith([...card, deleteCall("c1", "output-available")]);
    expect(cardContinuation(ran, callsTag(["c9"]))).toBeUndefined();
  });
});
