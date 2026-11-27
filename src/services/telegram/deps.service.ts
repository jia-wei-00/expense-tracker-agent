import { createAdminClient } from "@supabase/server/core";
import { createTelegramClient } from "@/libs/telegram";
import type { TAppBindings } from "@/types/common";
import type { Database } from "@/types/database";
import type { TTelegramDeps } from "@/types/telegram";

/**
 * What the Telegram path needs outside a Hono request: the service-role client
 * (built from the same bindings `withSupabase` reads) and the Bot API client.
 */
export function createTelegramDeps(env: TAppBindings): TTelegramDeps {
  const admin = createAdminClient<Database>({
    env: {
      url: env.SUPABASE_URL,
      secretKeys: { default: env.SUPABASE_SECRET_KEY },
      publishableKeys: { default: env.SUPABASE_PUBLISHABLE_KEY },
      jwks: new URL(env.SUPABASE_JWKS_URL),
    },
  });
  return { env, admin, telegram: createTelegramClient({ token: env.TELEGRAM_BOT_TOKEN }) };
}
