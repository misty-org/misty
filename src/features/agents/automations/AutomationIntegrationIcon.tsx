import { cn } from "@/shared/ui";
import { Braces, Clock3, Filter, GitBranch, Globe2, Repeat2, Webhook } from "lucide-react";
import type { ComponentType } from "react";
import { FaSlack } from "react-icons/fa6";
import {
  SiAirtable,
  SiDiscord,
  SiDropbox,
  SiGithub,
  SiGmail,
  SiGooglecalendar,
  SiGooglesheets,
  SiHubspot,
  SiLinear,
  SiNotion,
  SiStripe,
  SiTypeform,
} from "react-icons/si";

type Brand = { icon: ComponentType<{ className?: string }>; color: string };
const brands: Array<[string[], Brand]> = [
  [["gmail", "email"], { icon: SiGmail, color: "#EA4335" }],
  [["google-sheets", "googlesheets", "sheet"], { icon: SiGooglesheets, color: "#34A853" }],
  [["calendar"], { icon: SiGooglecalendar, color: "#4285F4" }],
  [["slack"], { icon: FaSlack, color: "#E01E5A" }],
  [["notion"], { icon: SiNotion, color: "#f5f2ea" }],
  [["github"], { icon: SiGithub, color: "#f5f2ea" }],
  [["discord"], { icon: SiDiscord, color: "#5865F2" }],
  [["dropbox"], { icon: SiDropbox, color: "#0061FF" }],
  [["linear"], { icon: SiLinear, color: "#8A8FEC" }],
  [["airtable"], { icon: SiAirtable, color: "#F82B60" }],
  [["hubspot"], { icon: SiHubspot, color: "#FF7A59" }],
  [["typeform"], { icon: SiTypeform, color: "#D6FF6B" }],
  [["stripe"], { icon: SiStripe, color: "#635BFF" }],
];

export function AutomationIntegrationIcon(props: {
  value: string;
  className?: string;
  framed?: boolean;
}) {
  const value = props.value.toLowerCase();
  const match = brands.find(([keys]) => keys.some((key) => value.includes(key)))?.[1];
  const fallback = utilityIcon(value);
  const Icon = match?.icon ?? fallback.icon;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        props.framed && "size-9 rounded-lg border border-charcoal-border bg-charcoal-bg/65",
        props.className,
      )}
      style={{ color: match?.color ?? fallback.color }}
      aria-hidden="true"
    >
      <Icon className="size-[18px]" />
    </span>
  );
}

function utilityIcon(value: string): Brand {
  if (value.includes("webhook")) return { icon: Webhook, color: "#65B7D7" };
  if (value.includes("schedule") || value.includes("clock")) return { icon: Clock3, color: "#D7B568" };
  if (value.includes("router") || value.includes("branch")) return { icon: GitBranch, color: "#B89BE8" };
  if (value.includes("loop")) return { icon: Repeat2, color: "#6BCBA4" };
  if (value.includes("filter")) return { icon: Filter, color: "#E69A6A" };
  if (value.includes("code")) return { icon: Braces, color: "#77A7F2" };
  return { icon: Globe2, color: "#9BA49C" };
}
