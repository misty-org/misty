import { useState } from "react";
import { Globe } from "lucide-react";
import { mistyBrowserProviders } from "@/shared/schemas";
import { BrandIcon, brandIconAsset } from "@/shared/ui";
import { SiteIcon } from "./webviews/SiteIcon";

/** Resolve branding from the saved launch address, independent of the current page. */
export function SavedWebsiteIcon({ url }: { url: string }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  let address: URL;
  try {
    address = new URL(url);
  } catch {
    return <Globe size={18} />;
  }
  if (!["https:", "http:"].includes(address.protocol)) return <Globe size={18} />;
  const hostname = address.hostname.replace(/^www\./, "");
  const provider = Object.entries(mistyBrowserProviders)
    .map(([id, policy]) => ({ ...policy, id }))
    .filter((item) =>
      item.domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`)),
    )
    .sort(
      (a, b) =>
        Number(new URL(b.url).hostname.replace(/^www\./, "") === hostname) -
        Number(new URL(a.url).hostname.replace(/^www\./, "") === hostname),
    )[0];
  if (provider && brandIconAsset(provider.id)) return <BrandIcon brand={provider.id} size={18} />;
  const favicon = `${address.origin}/favicon.ico`;
  return failedUrl === favicon ? (
    <Globe size={18} />
  ) : (
    <SiteIcon
      url={favicon}
      className="size-[18px] shrink-0 object-contain"
      onFailed={() => setFailedUrl(favicon)}
    />
  );
}
