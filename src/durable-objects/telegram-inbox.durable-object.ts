import { DurableObject } from "cloudflare:workers";
import { TELEGRAM_COPY } from "@/constants/telegram";
import { setupBraintrust } from "@/libs/braintrust";
import { inboxRowSchema, telegramUpdateSchema } from "@/schemas/telegram.schema";
import { createTelegramDeps } from "@/services/telegram/deps.service";
import { handleUpdate } from "@/services/telegram/update.service";
import type { TAppBindings } from "@/types/common";
import type { TInboxRow, TTelegramDeps, TTelegramUpdate } from "@/types/telegram";
import { inboxStep, withinRunBudget } from "@/utils/inbox";
import { chatIdOf, classifyUpdate } from "@/utils/telegram";

/**
 * One inbox per Telegram chat (named by chat id). The webhook stores each
 * update here and returns; an alarm then processes the chat's updates one at a
 * time, oldest first, so two quick messages never run concurrently.
 *
 * - Dedupe: `update_id` is the primary key, so a redelivered update that is
 *   still queued is ignored.
 * - Retries: `attempts` is incremented before each try; a throw propagates and
 *   the runtime retries the alarm, keeping later updates queued behind it.
 * - Poison: an update seen past `INBOX_MAX_ATTEMPTS` is dropped, logged, and the
 *   chat is asked to resend.
 */
export class TelegramInbox extends DurableObject<TAppBindings> {
  constructor(ctx: DurableObjectState, env: TAppBindings) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      create table if not exists updates (
        update_id integer primary key,
        body text not null,
        attempts integer not null default 0,
        received_at integer not null
      )`);
  }

  async enqueue(update: TTelegramUpdate): Promise<void> {
    this.ctx.storage.sql.exec(
      "insert into updates (update_id, body, received_at) values (?, ?, ?) on conflict (update_id) do nothing",
      update.update_id,
      JSON.stringify(update),
      Date.now(),
    );
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now());
    }
  }

  async alarm(): Promise<void> {
    setupBraintrust(this.env.BRAINTRUST_API_KEY, (promise) => {
      this.ctx.waitUntil(promise);
    });
    const deps = createTelegramDeps(this.env);
    const startedAt = Date.now();

    while (withinRunBudget(startedAt, Date.now())) {
      const row = this.oldestRow();
      if (!row) return;
      await this.processRow(deps, row);
    }
    // Budget spent with work left: continue in a fresh alarm run.
    if (this.oldestRow()) await this.ctx.storage.setAlarm(Date.now());
  }

  private oldestRow(): TInboxRow | undefined {
    const [row] = this.ctx.storage.sql
      .exec("select update_id, body, attempts from updates order by update_id limit 1")
      .toArray();
    return row === undefined ? undefined : inboxRowSchema.parse(row);
  }

  private async processRow(deps: TTelegramDeps, row: TInboxRow): Promise<void> {
    const attempts = row.attempts + 1;
    this.ctx.storage.sql.exec(
      "update updates set attempts = ? where update_id = ?",
      attempts,
      row.update_id,
    );

    // The body was validated before it was stored, so this only fails if the
    // schema changed in between; such a row can never succeed.
    const parsed = telegramUpdateSchema.safeParse(JSON.parse(row.body));
    if (!parsed.success) {
      this.deleteRow(row.update_id);
      logOutcome(row.update_id, undefined, "invalid");
      return;
    }

    const update = parsed.data;
    if (inboxStep(attempts) === "drop") {
      this.deleteRow(row.update_id);
      await dropPoison(deps, update);
      return;
    }

    try {
      await handleUpdate(deps, update);
    } catch (error) {
      logOutcome(update.update_id, chatIdOf(update), `failed (attempt ${attempts})`, classifyUpdate(update));
      throw error;
    }
    this.deleteRow(row.update_id);
    logOutcome(update.update_id, chatIdOf(update), "processed", classifyUpdate(update));
  }

  private deleteRow(updateId: number): void {
    this.ctx.storage.sql.exec("delete from updates where update_id = ?", updateId);
  }
}

/** Tells the chat its update was given up on. Best effort: the row is already gone. */
async function dropPoison(deps: TTelegramDeps, update: TTelegramUpdate): Promise<void> {
  const chatId = chatIdOf(update);
  logOutcome(update.update_id, chatId, "dropped", classifyUpdate(update));
  if (chatId === undefined) return;
  try {
    await deps.telegram.sendMessage({ chatId, text: TELEGRAM_COPY.poisonUpdate });
  } catch (error) {
    console.error(`telegram poison reply failed (update ${update.update_id}):`, error);
  }
}

function logOutcome(updateId: number, chatId: number | undefined, outcome: string, kind?: string): void {
  console.log(JSON.stringify({ log: "telegram_inbox", update_id: updateId, chat_id: chatId, kind, outcome }));
}
