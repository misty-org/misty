export function replyPrompt(quote: string, prompt: string) {
  const quoted = quote
    .trim()
    .split("\n")
    .map((line) => `> ${line}`.trimEnd())
    .join("\n");
  return `${quoted}\n\n${prompt}`;
}

export function splitReplyQuote(content: string) {
  const match = /^((?:>.*(?:\n|$))+)\n*([\s\S]*)$/.exec(content);
  if (!match || !match[2].trim()) return { body: content };
  return {
    quote: match[1].replace(/^> ?/gm, "").trim(),
    body: match[2],
  };
}
