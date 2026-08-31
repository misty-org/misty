import gmailLogo from "@/shared/assets/mail-providers/gmail-user-supplied.svg";
import outlookLogo from "@/shared/assets/mail-providers/outlook-user-supplied.svg";
import { cn } from "./utils";

export type MailProviderType = "google" | "microsoft";

export function MailProviderIcon(props: {
  provider: MailProviderType | string;
  className?: string;
  "aria-hidden"?: boolean;
}) {
  const isGoogle = props.provider === "google";
  return (
    <img
      src={isGoogle ? gmailLogo : outlookLogo}
      alt=""
      aria-hidden={props["aria-hidden"] ?? true}
      className={cn("size-4 shrink-0 object-contain brightness-0 invert", props.className)}
      data-mail-provider-icon={isGoogle ? "gmail" : "outlook"}
    />
  );
}
