import { openAccountSettingsInBrowser } from "@/features/account/openAccountSettings";
import { Button } from "@/shared/ui";

/**
 * Stands in for the Code and Project menus on plans without coding: one plain line and
 * the button that changes the plan.
 */
export function CodingUpgradeNote() {
  return (
    <div className="flex flex-col items-start gap-2 px-2 py-1.5">
      <p className="text-sm text-cream-muted">
        Coding is part of Misty Pro and above. Upgrade to work in projects with your coding tools.
      </p>
      <Button size="sm" onClick={() => void openAccountSettingsInBrowser("/settings/billing")}>
        Upgrade
      </Button>
    </div>
  );
}
