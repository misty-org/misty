/** Digits only, in groups of four as a person reads a card, however it was typed or pasted. */
export function formatCardNumber(text: string): string {
  const digits = text.replace(/\D/g, "").slice(0, 19);
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
}

/** `12/31` or `12 / 2031` as a month and a full year, or null if it isn't a date. */
export function parseCardExpiry(text: string): { month: number; year: number } | null {
  const match = text.trim().match(/^(\d{1,2})\s*[/-]?\s*(\d{2}|\d{4})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const year = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { month, year: year < 100 ? 2000 + year : year };
}

/** How an expiry is shown: `03/31`. */
export function formatCardExpiry(month: number, year: number): string {
  return `${String(month).padStart(2, "0")}/${String(year % 100).padStart(2, "0")}`;
}
