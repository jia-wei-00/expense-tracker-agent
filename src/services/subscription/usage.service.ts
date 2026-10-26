import { HTTP_STATUS } from "@/constants/error";
import { AI_LIMITS, USAGE_TIMEZONE } from "@/constants/subscription";
import { ChatError } from "@/services/ai/chat/chat.error";
import type { TSupabaseAdminClient } from "@/types/common";
import type { TAiUsageKind, TAiUsageResult } from "@/types/subscription";

/**
 * Consumes one unit of the user's monthly AI quota, or throws the
 * problem+json error the handler should return: 402 without an active plan,
 * 429 once the month's limit is reached. The RPC checks the tier and
 * increments the counter in one statement, so concurrent calls serialize.
 */
export async function consumeAiUsage(
  admin: TSupabaseAdminClient,
  userId: string,
  kind: TAiUsageKind,
): Promise<TAiUsageResult> {
  const { data, error } = await admin.rpc("consume_ai_usage", {
    p_user_id: userId,
    p_kind: kind,
    p_plus_limit: AI_LIMITS.plus[kind],
    p_pro_limit: AI_LIMITS.pro[kind],
  });
  if (error) throw new Error(error.message);

  const usage = data[0];
  if (!usage) throw new Error("consume_ai_usage returned no row");

  if (usage.tier === "free") {
    throw new ChatError(
      HTTP_STATUS.PAYMENT_REQUIRED,
      "Subscription required",
      "AI features need an active Plus or Pro plan.",
    );
  }
  if (!usage.allowed) {
    throw new ChatError(
      HTTP_STATUS.TOO_MANY_REQUESTS,
      "Monthly AI limit reached",
      `Used ${String(usage.used)}/${String(usage.quota)} ${kind}s for ${usage.period}; resets on the 1st (${USAGE_TIMEZONE}).`,
      { kind, used: usage.used, quota: usage.quota, period: usage.period, tier: usage.tier },
    );
  }
  return usage;
}
