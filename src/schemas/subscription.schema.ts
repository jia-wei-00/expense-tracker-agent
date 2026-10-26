import { z } from "zod";

/** Subscription tier stored on `user_profile.tier`. */
export const tierSchema = z.enum(["free", "plus", "pro"]);

/** Which monthly AI counter a request consumes. */
export const aiUsageKindSchema = z.enum(["chat", "scan"]);
