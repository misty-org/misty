import { apiRequest } from "@/api/client";
import { mistyWebsite } from "@/api/deployment/server_choice";
import { openSystemExternalLink } from "@/shared/platform/open_external_link";

export async function openOnWebsite(path: string): Promise<void> {
  const website = mistyWebsite();
  let link = `${website}${path}`;
  try {
    const { code } = await apiRequest<{ code: string }>("/me/web-handoff", { method: "POST" });
    if (code)
      link = `${website}/continue?next=${encodeURIComponent(path)}#code=${encodeURIComponent(code)}`;
  } catch {}
  await openSystemExternalLink(link);
}
