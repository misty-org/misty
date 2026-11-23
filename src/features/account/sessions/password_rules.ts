const MIN_CHARS = 8;
const MAX_BYTES = 72;

export function passwordProblem(password: string): string | null {
  if ([...password].length < MIN_CHARS) return "Use at least 8 characters.";
  if (new TextEncoder().encode(password).length > MAX_BYTES) return "Use 72 bytes or fewer.";
  if (!/\p{Lowercase}/u.test(password)) return "Include a lowercase letter.";
  if (!/[^\p{Alphabetic}\p{N}]/u.test(password)) return "Include a special character.";
  return null;
}
