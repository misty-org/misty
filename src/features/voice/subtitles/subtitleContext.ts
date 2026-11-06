// From Audeeo (MIT, Matthew Chen): what a session is about, in the shape Soniox takes.
export const subtitleCategories = [
  { value: "general", label: "General" },
  { value: "business", label: "Business" },
  { value: "education", label: "Education" },
  { value: "technology", label: "Technology" },
  { value: "science", label: "Science" },
  { value: "medical", label: "Medical" },
  { value: "legal", label: "Legal" },
  { value: "finance", label: "Finance" },
  { value: "news-politics", label: "News and politics" },
  { value: "religious-spiritual", label: "Religious and spiritual" },
  { value: "philosophy", label: "Philosophy" },
  { value: "entertainment", label: "Entertainment" },
  { value: "sports", label: "Sports" },
  { value: "travel", label: "Travel" },
  { value: "custom", label: "Custom" },
];

export interface TranslationTerm {
  source: string;
  target: string;
}

export interface SubtitleContext {
  category: string;
  customCategory: string;
  text: string;
  terms: string[];
  translationTerms: TranslationTerm[];
}

export const emptySubtitleContext = (): SubtitleContext => ({
  category: "general",
  customCategory: "",
  text: "",
  terms: [],
  translationTerms: [],
});

export function parseTerms(value: string) {
  return [
    ...new Set(
      value
        .split(/[\n,]/)
        .map((term) => term.trim())
        .filter(Boolean),
    ),
  ].slice(0, 100);
}

export function parseTranslationTerms(value: string): TranslationTerm[] {
  return value
    .split("\n")
    .map((line) => {
      const parts = line.split(/\s*(?:=>|=|→)\s*/);
      return { source: (parts.shift() || "").trim(), target: parts.join(" = ").trim() };
    })
    .filter((term) => term.source && term.target)
    .slice(0, 100);
}

export function formatTranslationTerms(terms: TranslationTerm[]) {
  return terms.map((term) => `${term.source} = ${term.target}`).join("\n");
}

export function categoryLabel(context: SubtitleContext) {
  if (context.category === "custom") return context.customCategory.trim() || "Custom";
  return subtitleCategories.find((item) => item.value === context.category)?.label ?? "General";
}

export function sonioxContext(context: SubtitleContext) {
  const domain = context.category === "general" ? "" : categoryLabel(context);
  return {
    ...(domain ? { general: [{ key: "domain", value: domain }] } : {}),
    ...(context.text.trim() ? { text: context.text.trim() } : {}),
    ...(context.terms.length ? { terms: context.terms } : {}),
    ...(context.translationTerms.length ? { translation_terms: context.translationTerms } : {}),
  };
}
