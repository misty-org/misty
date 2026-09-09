import { cn } from "@/shared/ui";
import {
  Braces,
  Clock3,
  Filter,
  GitBranch,
  Globe2,
  Repeat2,
  Webhook,
} from "lucide-react";
import type { ComponentType } from "react";
import { BrandIcon } from "../../../shared/BrandIcon";
import { brandIconAsset, type BrandId } from "../../../shared/brandIcons";

type Brand = { icon: ComponentType<{ className?: string }>; color: string };
const brands: Array<[string[], BrandId]> = [
  [["outlook", "microsoft-mail"], "outlook"],
  [["gmail", "email"], "gmail"],
  [["google-sheets", "googlesheets", "sheet"], "google-sheets"],
  [["calendar"], "google-calendar"],
  [["slack"], "slack"],
  [["notion"], "notion"],
  [["github"], "github"],
  [["discord"], "discord"],
  [["dropbox"], "dropbox"],
  [["linear"], "linear"],
  [["airtable"], "airtable"],
  [["hubspot"], "hubspot"],
  [["typeform"], "typeform"],
  [["stripe"], "stripe"],
  [["todoist"], "todoist"],
  [["trello"], "trello"],
  [["asana"], "asana"],
  [["jira"], "jira"],
  [["google-drive"], "google-drive"],
];

export function AutomationIntegrationIcon(props: {
  value: string;
  className?: string;
  framed?: boolean;
}) {
  const value = props.value.toLowerCase();
  const match =
    brandIconAsset(value)?.id ??
    brands.find(([keys]) => keys.some((key) => value.includes(key)))?.[1];
  const fallback = utilityIcon(value);
  const Icon = fallback.icon;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        props.framed &&
          "size-9 rounded-lg border border-charcoal-border bg-charcoal-bg/65",
        props.className,
      )}
      style={match ? undefined : { color: fallback.color }}
      aria-hidden="true"
    >
      {match ? (
        <BrandIcon brand={match} size={18} />
      ) : (
        <Icon className="size-[18px]" />
      )}
    </span>
  );
}

function utilityIcon(value: string): Brand {
  if (value.includes("webhook")) return { icon: Webhook, color: "#65B7D7" };
  if (value.includes("schedule") || value.includes("clock"))
    return { icon: Clock3, color: "#D7B568" };
  if (value.includes("router") || value.includes("branch"))
    return { icon: GitBranch, color: "#B89BE8" };
  if (value.includes("loop")) return { icon: Repeat2, color: "#6BCBA4" };
  if (value.includes("filter")) return { icon: Filter, color: "#E69A6A" };
  if (value.includes("code")) return { icon: Braces, color: "#77A7F2" };
  return { icon: Globe2, color: "#9BA49C" };
}
