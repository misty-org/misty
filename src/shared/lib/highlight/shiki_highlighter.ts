import {
  createCssVariablesTheme,
  createHighlighterCore,
  type HighlighterCore,
  type ThemedToken,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { codeGrammar } from "./code_languages";

const theme = createCssVariablesTheme({ name: "misty", variablePrefix: "--shiki-" });
let highlighter: Promise<HighlighterCore> | undefined;

function core() {
  highlighter ??= createHighlighterCore({
    themes: [theme],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return highlighter;
}

export async function tokenize(code: string, language: string): Promise<ThemedToken[][]> {
  const shiki = await core();
  if (!shiki.getLoadedLanguages().includes(language))
    await shiki.loadLanguage(codeGrammar(language));
  return shiki.codeToTokensBase(code, { lang: language, theme: "misty" });
}
