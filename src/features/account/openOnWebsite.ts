import { apiRequest } from "@/api/client";
import { mistyWebsite } from "@/api/deployment/serverChoice";
import { openSystemExternalLink } from "@/shared/platform/openExternalLink";

/**
 * Opens a page of Misty's website in the browser, signed in as this account. The server gives
 * a single-use code that lasts two minutes, and it rides in the link's fragment, which never
 * reaches a server. If the server can't give one, the page opens as it is and the website
 * asks the person to sign in.
 */
export async function openOnWebsite(path: string): Promise<void> {
  const website = mistyWebsite();
  let link = `${website}${path}`;
  try {
    const { code } = await apiRequest<{ code: string }>("/me/web-handoff", { method: "POST" });
    if (code)
      link = `${website}/continue?next=${encodeURIComponent(path)}#code=${encodeURIComponent(code)}`;
  } catch {
    // The plain page still works, after signing in there.
  }
  await openSystemExternalLink(link);
}
