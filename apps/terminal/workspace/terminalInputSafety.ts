export function hasTerminalControlCharacters(value: string) {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code === 127 || code < 32;
  });
}
