import { runOnEngine } from "../engines/engineRun";
import { jsonOf, jsonReply } from "./tutorPrompts";

/**
 * A notebook's news, found by the default engine with its own web search: Misty holds no search
 * key. Failures throw one plain sentence the person can act on.
 */
interface NewsItem {
  title: string;
  url: string;
  source?: string;
  /** When it was published, as the engine found it ("2 hours ago", "Nov 12, 2026"). */
  published?: string;
}

const spans = { day: "the past day", week: "the past week", month: "the past month" } as const;

/** What the engine is asked: recent stories only, from its own searches, as JSON. */
export function newsPrompt(query: string, recency: keyof typeof spans = "week"): string {
  return [
    `Find news stories about: ${query}`,
    `Search the web for stories published in ${spans[recency]}, newest first, at most eight. ` +
      "Only include addresses that came back in your search results, and don't open the pages.",
    jsonReply(
      '{"stories": [{"title": string, "url": string, "source": string, "published": string}]}',
      "source is the outlet's name; published is the date or how long ago, as the results say.",
    ),
  ].join("\n\n");
}

/** The stories in the engine's answer, each with a web address, at most eight. */
export function parseNews(reply: string): NewsItem[] {
  const value = jsonOf(reply) as { stories?: unknown } | undefined;
  if (!value || !Array.isArray(value.stories)) return [];
  const text = (item: unknown, most: number) =>
    typeof item === "string" ? item.trim().slice(0, most) : "";
  return value.stories
    .flatMap((item: Record<string, unknown>) => {
      const url = text(item?.url, 2000);
      try {
        const parsed = new URL(url);
        if (!/^https?:$/.test(parsed.protocol)) return [];
        return [
          {
            title: text(item.title, 200) || parsed.hostname,
            url: parsed.href,
            source: text(item.source, 80) || undefined,
            published: text(item.published, 60) || undefined,
          },
        ];
      } catch {
        return [];
      }
    })
    .slice(0, 8);
}

/** Recent news about `query`, newest first, found by the default engine. */
export async function latestNews(
  query: string,
  recency?: "day" | "week" | "month",
): Promise<NewsItem[]> {
  const result = await runOnEngine({
    prompt: newsPrompt(query, recency),
    key: `news:${query}:${new Date().toISOString().slice(0, 13)}`,
  });
  if (result.error && !result.text.trim()) throw new Error(result.error);
  return parseNews(result.text);
}
