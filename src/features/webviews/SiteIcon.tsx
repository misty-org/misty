import { useEffect, useState } from "react";
import { cn } from "@/shared/ui";
import { knownSiteIcon, loadSiteIcon } from "./siteIconLoader";

/**
 * A site's icon, fetched by the app so a site's headers can't block it. An icon that wouldn't show
 * on the current theme gets a small backing (`.misty-site-icon` in base.css). The space is held
 * while it loads; `onFailed` says there is none, for the caller to show its own fallback.
 */
export function SiteIcon(props: { url: string; className?: string; onFailed?: () => void }) {
  const { url, onFailed } = props;
  const [loaded, setLoaded] = useState(() => ({ url, icon: knownSiteIcon(url) }));
  const icon = loaded.url === url ? loaded.icon : knownSiteIcon(url);

  useEffect(() => {
    let active = true;
    void loadSiteIcon(url).then((next) => {
      if (active) setLoaded({ url, icon: next });
    });
    return () => {
      active = false;
    };
  }, [url]);
  useEffect(() => {
    if (icon === null) onFailed?.();
  }, [icon, onFailed]);

  const className = cn("misty-site-icon", props.className);
  if (!icon) return <span aria-hidden="true" className={className} />;
  return (
    <img
      alt=""
      className={className}
      data-tone={icon.tone}
      decoding="async"
      draggable={false}
      onError={onFailed}
      src={icon.src}
    />
  );
}
