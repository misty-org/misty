import type { LanguageSupport } from "@codemirror/language";

type LanguageLoader = () => Promise<LanguageSupport>;

const languageLoaders: Record<string, LanguageLoader> = {
  ts: () =>
    import("@codemirror/lang-javascript").then(({ javascript }) =>
      javascript({ jsx: true, typescript: true }),
    ),
  tsx: () =>
    import("@codemirror/lang-javascript").then(({ javascript }) =>
      javascript({ jsx: true, typescript: true }),
    ),
  js: () =>
    import("@codemirror/lang-javascript").then(({ javascript }) => javascript({ jsx: true })),
  jsx: () =>
    import("@codemirror/lang-javascript").then(({ javascript }) => javascript({ jsx: true })),
  mjs: () => import("@codemirror/lang-javascript").then(({ javascript }) => javascript()),
  cjs: () => import("@codemirror/lang-javascript").then(({ javascript }) => javascript()),
  json: () => import("@codemirror/lang-json").then(({ json }) => json()),
  css: () => import("@codemirror/lang-css").then(({ css }) => css()),
  scss: () => import("@codemirror/lang-css").then(({ css }) => css()),
  html: () => import("@codemirror/lang-html").then(({ html }) => html()),
  htm: () => import("@codemirror/lang-html").then(({ html }) => html()),
  md: () => import("@codemirror/lang-markdown").then(({ markdown }) => markdown()),
  mdx: () => import("@codemirror/lang-markdown").then(({ markdown }) => markdown()),
  rs: () => import("@codemirror/lang-rust").then(({ rust }) => rust()),
  py: () => import("@codemirror/lang-python").then(({ python }) => python()),
};

const languageCache = new Map<string, Promise<LanguageSupport | null>>();

/** Load only the parser needed by the active file, and reuse it on later visits. */
export function loadCodeMirrorLanguage(filename: string): Promise<LanguageSupport | null> {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  const cached = languageCache.get(extension);
  if (cached) return cached;

  const loader = languageLoaders[extension];
  const pending = loader ? loader().catch(() => null) : Promise.resolve(null);
  languageCache.set(extension, pending);
  return pending;
}
