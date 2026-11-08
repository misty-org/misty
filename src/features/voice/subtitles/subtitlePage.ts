import { invoke } from "@tauri-apps/api/core";
import { deviceModelCall } from "@/api/runtime/device-models";
import { browserRuntimeIdForTabId } from "@/features/browser";
import { activeLayoutView } from "@/features/app-windows";
import { useWorkspaceStore } from "@/features/app-windows";
import type { PageContext } from "./subtitleContext";

/** Wide enough for the model to read the names on the page. */
const PICTURE_WIDTH = 1280;

export interface CurrentPage {
  runtimeId: string;
  title: string;
  url: string;
}

/** The web page in front of the person in this window, if a web page is what's in front. */
export function currentPage(): CurrentPage | undefined {
  const view = activeLayoutView(useWorkspaceStore.getState().layout);
  if (!view || view.surfaceId !== "browser") return undefined;
  const url = (view.state as { url?: unknown } | null)?.url;
  const runtimeId = browserRuntimeIdForTabId(view.id);
  if (!runtimeId || typeof url !== "string" || !/^https?:\/\//.test(url)) return undefined;
  return { runtimeId, title: view.title.slice(0, 300), url: url.slice(0, 2048) };
}

/** A page is its address: a new title or a jump within the page isn't a new page. */
export const pageKey = (page: CurrentPage) => page.url.split("#")[0];

/**
 * One look at the page on the person's own agent model. Without a picture, which a protected video
 * or Windows can't give, the title and address still say a lot.
 */
export async function readPage(page: CurrentPage, source: string, target: string) {
  const picture = await invoke<{ dataUrl?: string }>("browser_webview_picture", {
    request: { id: page.runtimeId, width: PICTURE_WIDTH },
  }).catch(() => undefined);
  const reply = await deviceModelCall<{
    domain: string;
    topic: string;
    terms: string[];
    translation_terms: PageContext["translationTerms"];
  }>("subtitle-context", {
    ...(picture?.dataUrl ? { image: { data_url: picture.dataUrl } } : {}),
    title: page.title,
    url: page.url,
    source,
    target,
  });
  return {
    domain: reply.domain,
    topic: reply.topic,
    terms: reply.terms,
    translationTerms: reply.translation_terms,
  } satisfies PageContext;
}
