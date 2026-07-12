import { relevance } from "../relevance";
import type { OmniboxProvider } from "../types";
import { describeUrl, directWebUrl, urlKey } from "../urlText";
import type { OmniboxDeps } from "./deps";

/**
 * Before typing, a web address on the clipboard, like Chrome's "Link you
 * copied". Read locally and never fetched: no favicon until visited.
 */
export function copiedLinkProvider(deps: OmniboxDeps): OmniboxProvider {
  return {
    id: "copied-link",
    async start(input) {
      if (input.text.trim() || input.private) return [];
      const copied = await deps.clipboardUrl().catch(() => null);
      const url = copied ? directWebUrl(copied) : null;
      const described = url ? describeUrl(url) : null;
      if (!url || !described || urlKey(url) === urlKey(input.currentUrl)) return [];
      return [
        {
          id: `copied:${url}`,
          kind: "url",
          title: "Link you copied",
          detail: described.detail,
          target: { type: "navigate", url },
          relevance: relevance.copiedLink,
          allowedToBeDefault: false,
          faviconUrl: null,
        },
      ];
    },
  };
}
