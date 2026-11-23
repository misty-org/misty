import { invoke } from "@/native/invoke";
import { readPickedElement, type PickedElement } from "./picked_element";

export interface PagePick {
  element: PickedElement;
  image?: string;
}

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

export const pickApi = {
  watch: (id: string) => invoke<void>("browser_page_watch", { id }),
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
