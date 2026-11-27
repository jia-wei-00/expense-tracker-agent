/** Best-effort human-readable message from an unknown thrown value. */
export const toMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
