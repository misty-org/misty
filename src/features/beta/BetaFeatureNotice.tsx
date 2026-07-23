import type { LucideIcon } from "lucide-react";
import { CalendarDays, ExternalLink } from "lucide-react";
import { Badge, Button, Card } from "@/ui";
import { openExternalLink } from "@/platform/openExternalLink";

const betaWebsiteUrl = "https://mistysys.com";

export function BetaFeatureNotice({
  featureName,
  icon: Icon,
}: {
  featureName: string;
  icon: LucideIcon;
}) {
  return (
    <div className="grid h-full min-h-0 place-items-center overflow-y-auto bg-background px-6 py-10 text-foreground">
      <Card className="w-full max-w-lg items-center px-8 py-10 text-center" size="sm">
        <div className="grid size-12 place-items-center rounded-xl bg-muted text-muted-foreground">
          <Icon size={24} strokeWidth={1.8} aria-hidden="true" />
        </div>
        <Badge className="mt-1" variant="secondary">
          Beta v0.2.0
        </Badge>
        <div className="grid gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{featureName} are coming soon</h1>
          <p className="mx-auto max-w-sm text-sm leading-6 text-muted-foreground">
            Coming soon in beta v0.2.0, estimated August 9, 2026. Check out the Misty website for
            more information.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CalendarDays size={14} aria-hidden="true" />
          <span>Estimated August 9, 2026</span>
        </div>
        <Button type="button" onClick={() => void openExternalLink(betaWebsiteUrl)}>
          Visit mistysys.com
          <ExternalLink size={15} aria-hidden="true" />
        </Button>
      </Card>
    </div>
  );
}
