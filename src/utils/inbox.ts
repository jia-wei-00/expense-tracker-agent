import { INBOX_MAX_ATTEMPTS, INBOX_RUN_BUDGET_MS } from "@/constants/telegram";
import type { TInboxStep } from "@/types/telegram";

/**
 * `attempts` already counts the run about to start, so an update is processed
 * at most `INBOX_MAX_ATTEMPTS` times and dropped on the next look.
 */
export function inboxStep(attempts: number): TInboxStep {
  return attempts > INBOX_MAX_ATTEMPTS ? "drop" : "process";
}

/** One alarm run stops taking new updates once its budget is spent (the runtime caps a run at 15 min). */
export function withinRunBudget(startedAt: number, now: number): boolean {
  return now - startedAt < INBOX_RUN_BUDGET_MS;
}
