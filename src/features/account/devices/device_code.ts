const alphabet = "BCDFGHJKLMNPQRSTVWXZ";
const codeLength = 8;

export const deviceCodePlaceholder = "XXXX-XXXX";

function letters(value: string): string {
  return [...value.toUpperCase()]
    .filter((letter) => alphabet.includes(letter))
    .join("")
    .slice(0, codeLength);
}

export function formatDeviceCode(value: string): string {
  const typed = letters(value);
  return typed.length > codeLength / 2
    ? `${typed.slice(0, codeLength / 2)}-${typed.slice(codeLength / 2)}`
    : typed;
}

export function isDeviceCode(value: string): boolean {
  return letters(value).length === codeLength && formatDeviceCode(value) === value;
}
