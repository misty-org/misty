import { invoke } from "@/native/invoke";
import { readPickedElement, type PickedElement } from "./pickedElement";

export interface PagePick {
  element: PickedElement;
  /** A picture of the element, where the page could be captured. */
  image?: string;
}

/**
 * Whether `url` is the person's own app on this computer: plain http on localhost, a `.localhost`
 * name or a loopback address. Only such a tab offers Pick an element; the native side checks the
 * same again (`browser/page_pick.rs`).
 */
export function isLocalPage(url: string | undefined): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" || parsed.username || parsed.password) return false;
  const host = parsed.hostname.replace(/\.$/, "").toLowerCase();
  return (
    host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "[::1]"
  );
}

/** Picking an element in a tab that shows the person's own local app. */
export const pickApi = {
  /** Starts keeping the page's errors for the next pick. Call after each load. */
  watch: (id: string) => invoke<void>("browser_page_watch", { id }),
  /** Waits for the person to pick an element; nothing when they cancel. */
  async pick(id: string): Promise<PagePick | null> {
    const picked = await invoke<{ element: unknown; image?: string | null } | null>(
      "browser_page_pick",
      { id },
    );
    const element = readPickedElement(picked?.element);
    if (!element) return null;
    const image = picked?.image?.startsWith("data:image/") ? picked.image : undefined;
    return { element, image };
  },
  cancelPick: (id: string) => invoke<void>("browser_page_cancel_pick", { id }),
};
