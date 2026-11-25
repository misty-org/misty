import { Globe } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@misty/ui";
import { knownPageIcon, loadPageIcon } from "./site_icon_loader";

export function SiteIcon(props: {
  url: string;
  icon?: string;
  className?: string;
  onFailed?: () => void;
}) {
  const { url, icon: reported, onFailed } = props;
  const key = `${reported ?? ""} ${url}`;
  const [loaded, setLoaded] = useState(() => ({ key, icon: knownPageIcon(url, reported) }));
  const [broken, setBroken] = useState("");
  const icon = loaded.key === key ? loaded.icon : knownPageIcon(url, reported);

  useEffect(() => {
    let active = true;
    void loadPageIcon(url, reported).then((next) => {
      if (active) setLoaded({ key, icon: next });
    });
    return () => {
      active = false;
    };
  }, [key, url, reported]);
  useEffect(() => {
    if (icon === null) onFailed?.();
  }, [icon, onFailed]);

  const className = cn("misty-site-icon", props.className);
  if (!icon || broken === icon.src) return <Globe aria-hidden="true" className={className} />;
  return (
    <img
      alt=""
      className={className}
      data-tone={icon.tone}
      decoding="async"
      draggable={false}
      onError={() => {
        setBroken(icon.src);
        onFailed?.();
      }}
      src={icon.src}
    />
  );
}
