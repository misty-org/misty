/**
 * Why a new Misty password is not acceptable, the same rules as the server's
 * (`accounts.ValidateNewPassword`), which has the last word. The longest it takes is bcrypt's limit.
 */
const MIN_CHARS = 8;
const MAX_BYTES = 72;

/** Why this password can't be used, in words for the person, or null when it can. */
export function passwordProblem(password: string): string | null {
  if ([...password].length < MIN_CHARS) return "Use at least 8 characters.";
  if (new TextEncoder().encode(password).length > MAX_BYTES) return "Use 72 bytes or fewer.";
  if (!/\p{Lowercase}/u.test(password)) return "Include a lowercase letter.";
  if (!/[^\p{Alphabetic}\p{N}]/u.test(password)) return "Include a special character.";
  return null;
}
