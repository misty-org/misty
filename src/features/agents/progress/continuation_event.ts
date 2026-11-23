const prefix = "Continue the request above.";

const events: [RegExp, (match: RegExpMatchArray) => string][] = [
  [/^Resume the open items/, () => "Resumed the open items"],
  [/^(.+) is now connected\.$/, (m) => `Connected ${m[1]}`],
  [/^The user approved [“"](.+)[”"]\.$/, (m) => `Approved “${m[1]}”`],
  [/^The user's screen is attached/, () => "Shared your screen"],
  [/^Misty can now use the user's desktop apps/, () => "Let Misty use your desktop apps"],
  [/^The user's open tab "(.+)" is now attached/, (m) => `Attached your tab “${m[1]}”`],
  [/^A browser on (.+) is now attached/, (m) => `Attached the browser on ${m[1]}`],
  [/now attached/, () => "Attached a browser"],
];

export function continuationEvent(content: string, source?: string): string | undefined {
  const text = content.trim();
  if (source !== "continuation" && !text.startsWith(prefix)) return undefined;
  const rest = text.startsWith(prefix) ? text.slice(prefix.length).trim() : text;
  for (const [pattern, label] of events) {
    const match = rest.match(pattern);
    if (match) return `${label(match)}, then Misty continued`;
  }
  return "Misty continued";
}
