import { Globe } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@misty/ui";
import { knownSiteIcon, loadSiteIcon } from "./site_icon_loader";

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
  if (!icon) return <Globe aria-hidden="true" className={className} />;
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
