export type AuthMode = "permissive" | "strict";

// Mirrors freighter-backend-v2 internal/auth/mode.go ParseMode:
// empty/unset -> permissive; "strict" -> strict; anything else throws.
export const parseMode = (value: string | undefined): AuthMode => {
  switch (value) {
    case undefined:
    case "":
    case "permissive":
      return "permissive";
    case "strict":
      return "strict";
    default:
      throw new Error(
        `invalid auth mode "${value}" (want "permissive" or "strict")`,
      );
  }
};
