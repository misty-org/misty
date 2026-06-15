import gmailLogo from "@/shared/assets/mail-providers/gmail-user-supplied.svg";
import outlookLogo from "@/shared/assets/mail-providers/outlook-user-supplied.svg";
import { cn } from "./utils";
import { AssetIcon } from "./asset-icon";

export type MailProviderType = "google" | "microsoft";

export function MailProviderIcon(props: {
  provider: MailProviderType | string;
  className?: string;
  "aria-hidden"?: boolean;
}) {
  const isGoogle = props.provider === "google";
  return (
    <span
      aria-hidden={props["aria-hidden"] ?? true}
      className={cn("inline-flex shrink-0", props.className)}
      data-mail-provider-icon={isGoogle ? "gmail" : "outlook"}
    >
      <AssetIcon src={isGoogle ? gmailLogo : outlookLogo} size={18} />
    </span>
  );
}
