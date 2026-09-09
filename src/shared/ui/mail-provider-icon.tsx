import { BrandIcon } from "../../../../misty-apps/apps/shared/BrandIcon";

export type MailProviderType = "google" | "microsoft";

export function MailProviderIcon(props: {
  provider: MailProviderType | string;
  className?: string;
  size?: number;
  "aria-hidden"?: boolean;
}) {
  return (
    <BrandIcon
      brand={props.provider}
      size={props.size ?? 18}
      className={props.className}
      aria-hidden={props["aria-hidden"] ?? true}
    />
  );
}
