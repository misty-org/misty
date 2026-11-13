import { invoke } from "@/native/invoke";

/**
 * A notebook's news, fetched by the native app on this computer from the person's search provider
 * on their own search key. The renderer never sees the key, and nothing goes to Misty's server.
 * Failures throw one plain sentence the person can act on, such as where to add a missing key.
 */
export interface NewsItem {
  title: string;
  url: string;
  source?: string;
  /** The search provider's own date text ("2 hours ago", "Nov 12, 2026"). */
  published?: string;
  snippet?: string;
}

/** Recent news about `query`, newest first as the search provider lists it. */
export async function latestNews(
  query: string,
  recency?: "day" | "week" | "month",
): Promise<NewsItem[]> {
  try {
    return await invoke<NewsItem[]>("notebook_news", { query, recency: recency ?? null });
  } catch (cause) {
    const text = typeof cause === "string" ? cause : cause instanceof Error ? cause.message : "";
    throw new Error(text.trim() || "News couldn't be loaded. Try again.");
  }
}
