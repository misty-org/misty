import { MistyMarkdown, runOnEngine } from "@/features/agents";
import type { WebTranslator } from "@/features/browser";

function readerLanguage(): string {
  const code = navigator.language || "en";
  try {
    return new Intl.DisplayNames([code], { type: "language" }).of(code.split("-")[0]) ?? "English";
  } catch {
    return "English";
  }
}

export const webTabTranslator: WebTranslator = {
  async translate(page, onText, signal) {
    const language = readerLanguage();
    const prompt = [
      `Translate this web page into ${language}.`,
      "Keep its headings, lists and links as Markdown and answer with the translation alone.",
      "If it is already in that language, say so in one sentence.",
      "",
      `Title: ${page.title}`,
      "",
      page.text,
    ].join("\n");
    const result = await runOnEngine({
      prompt,
      key: `translate-${crypto.randomUUID()}`,
      onText,
      signal,
    });
    if (result.error) throw new Error(result.error);
    return result.text;
  },
  render: (text, streaming) => <MistyMarkdown streaming={streaming}>{text}</MistyMarkdown>,
};
