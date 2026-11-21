import { chatInstructions } from "@/services/ai/prompts/chat.prompt";
import { describe, expect, it } from "vitest";

describe("chatInstructions", () => {
  it("app prompt is unchanged and telegram extends it", () => {
    const app = chatInstructions({ channel: "app" });
    expect(app.startsWith("You are an expense tracking assistant.")).toBe(true);
    expect(app).not.toContain("Telegram");
    const dm = chatInstructions({ channel: "telegram-dm" });
    expect(dm.startsWith(app)).toBe(true);
    expect(dm).toContain("Do not use Markdown");
  });
});
