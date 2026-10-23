const lower = "abcdefghijkmnopqrstuvwxyz";
const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const digits = "23456789";
const symbols = "!@#$%^&*-_=+?";

function randomBelow(limit: number): number {
  const range = 0x100000000;
  const max = range - (range % limit);
  const buffer = new Uint32Array(1);
  do crypto.getRandomValues(buffer);
  while (buffer[0] >= max);
  return buffer[0] % limit;
}

/** A random password with at least one character from each group. Look-alike characters are left out. */
export function generatePassword(length = 20): string {
  const groups = [lower, upper, digits, symbols];
  const size = Math.max(length, groups.length);
  const all = groups.join("");
  const chars = groups.map((group) => group[randomBelow(group.length)]);
  while (chars.length < size) chars.push(all[randomBelow(all.length)]);
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swap = randomBelow(index + 1);
    [chars[index], chars[swap]] = [chars[swap], chars[index]];
  }
  return chars.join("");
}
