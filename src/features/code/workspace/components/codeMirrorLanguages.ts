import { LanguageDescription, type LanguageSupport } from "@codemirror/language";
import { languages } from "@codemirror/language-data";

type LanguageLoader = () => Promise<LanguageSupport>;

const directLoaders: Record<string, LanguageLoader> = {
  // TypeScript & JavaScript
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

  // JSON
  json: () => import("@codemirror/lang-json").then(({ json }) => json()),
  jsonc: () => import("@codemirror/lang-json").then(({ json }) => json()),

  // Styles
  css: () => import("@codemirror/lang-css").then(({ css }) => css()),
  scss: () => import("@codemirror/lang-css").then(({ css }) => css()),
  less: () => import("@codemirror/lang-css").then(({ css }) => css()),

  // HTML / Web Markup
  html: () => import("@codemirror/lang-html").then(({ html }) => html()),
  htm: () => import("@codemirror/lang-html").then(({ html }) => html()),
  xhtml: () => import("@codemirror/lang-html").then(({ html }) => html()),

  // Markdown
  md: () => import("@codemirror/lang-markdown").then(({ markdown }) => markdown()),
  mdx: () => import("@codemirror/lang-markdown").then(({ markdown }) => markdown()),
  markdown: () => import("@codemirror/lang-markdown").then(({ markdown }) => markdown()),

  // Systems & Application Languages
  rs: () => import("@codemirror/lang-rust").then(({ rust }) => rust()),
  py: () => import("@codemirror/lang-python").then(({ python }) => python()),
  pyw: () => import("@codemirror/lang-python").then(({ python }) => python()),
  pyx: () => import("@codemirror/lang-python").then(({ python }) => python()),

  go: () => import("@codemirror/lang-go").then(({ go }) => go()),

  c: () => import("@codemirror/lang-cpp").then(({ cpp }) => cpp()),
  h: () => import("@codemirror/lang-cpp").then(({ cpp }) => cpp()),
  cpp: () => import("@codemirror/lang-cpp").then(({ cpp }) => cpp()),
  cc: () => import("@codemirror/lang-cpp").then(({ cpp }) => cpp()),
  cxx: () => import("@codemirror/lang-cpp").then(({ cpp }) => cpp()),
  hpp: () => import("@codemirror/lang-cpp").then(({ cpp }) => cpp()),
  ino: () => import("@codemirror/lang-cpp").then(({ cpp }) => cpp()),
  cs: () => import("@codemirror/lang-cpp").then(({ cpp }) => cpp()),

  java: () => import("@codemirror/lang-java").then(({ java }) => java()),

  // Config & Data Formats
  yaml: () => import("@codemirror/lang-yaml").then(({ yaml }) => yaml()),
  yml: () => import("@codemirror/lang-yaml").then(({ yaml }) => yaml()),
  sql: () => import("@codemirror/lang-sql").then(({ sql }) => sql()),
  xml: () => import("@codemirror/lang-xml").then(({ xml }) => xml()),
  svg: () => import("@codemirror/lang-xml").then(({ xml }) => xml()),
  plist: () => import("@codemirror/lang-xml").then(({ xml }) => xml()),
  php: () => import("@codemirror/lang-php").then(({ php }) => php()),
  phtml: () => import("@codemirror/lang-php").then(({ php }) => php()),
};

const languageCache = new Map<string, Promise<LanguageSupport | null>>();

/** Load only the parser needed by the active file, and reuse it on later visits. */
export function loadCodeMirrorLanguage(filename: string): Promise<LanguageSupport | null> {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  const cacheKey = extension || filename.toLowerCase();
  const cached = languageCache.get(cacheKey);
  if (cached) return cached;

  const direct = directLoaders[extension];
  if (direct) {
    const pending = direct().catch(() => null);
    languageCache.set(cacheKey, pending);
    return pending;
  }

  // Fallback to extensive language description list from @codemirror/language-data
  const desc =
    LanguageDescription.matchFilename(languages, filename) ??
    (extension ? LanguageDescription.matchFilename(languages, `file.${extension}`) : null) ??
    (extension ? languages.find((item) => item.extensions.includes(extension)) : null);

  if (desc) {
    const pending = desc.load().catch(() => null);
    languageCache.set(cacheKey, pending);
    return pending;
  }

  const none = Promise.resolve(null);
  languageCache.set(cacheKey, none);
  return none;
}
