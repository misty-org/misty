import { appIcon, appIcons, appIconStrokeWidth } from "@/shared/ui/app-icons";
import { BrandIcon } from "../../../../misty-apps/apps/shared/BrandIcon";
import { brandIconAsset } from "../../../../misty-apps/apps/shared/brandIcons";

export function OfficialAppIcon(props: { appId: string; size?: number }) {
  const Icon = appIcon(props.appId) ?? appIcons.code;
  const size = props.size ?? 38;
  return (
    <span
      className="grid shrink-0 place-items-center rounded-[10px] border border-charcoal-border bg-charcoal-card text-cream-bright"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {brandIconAsset(props.appId) ? (
        <BrandIcon brand={props.appId} size={Math.round(size * 0.64)} />
      ) : (
        <Icon size={Math.round(size * 0.48)} strokeWidth={appIconStrokeWidth} />
      )}
    </span>
  );
}
