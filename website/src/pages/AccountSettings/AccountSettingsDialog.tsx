import { useState } from "react";

import { DesktopSettingsFrame } from "@/components/settings";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { AccountPanel } from "./panels/AccountPanel";
import { BillingPanel } from "./panels/BillingPanel";
import { PrivacyPanel } from "./panels/PrivacyPanel";
import { UsagePanel } from "./panels/UsagePanel";
import { TABS, TAB_DESCRIPTIONS, type Tab } from "./tabs";
import { useAccountSettings } from "./useAccountSettings";

export function AccountSettingsDialog({
  open,
  onOpenChange,
  tab: controlledTab,
  onTabChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Supplied only when the dialog was opened from a settings URL. Left
   * undefined for the nav-menu overlay, which must not touch the address bar.
   */
  tab?: Tab;
  onTabChange?: (tab: Tab) => void;
}) {
  const [localTab, setLocalTab] = useState<Tab>("account");
  const tab = controlledTab ?? localTab;

  function setTab(next: Tab) {
    setLocalTab(next);
    onTabChange?.(next);
  }
  const {
    me,
    loading,
    loadError,
    usage,
    usageState,
    usageError,
    billingWorking,
    billingError,
    openBillingAction,
    renameAccount,
    bumpAvatarVersion,
    finishDeletion,
    retryUsage,
  } = useAccountSettings({ open, onOpenChange });

  const activeTab = TABS.find((item) => item.id === tab) ?? TABS[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="h-[min(760px,calc(100dvh-64px))] w-[min(980px,calc(100vw-64px))] max-w-none gap-0 overflow-hidden rounded-[18px] border border-border bg-card p-0 shadow-[0_28px_90px_rgba(0,0,0,0.62)] ring-0 max-[640px]:h-[calc(100dvh-24px)] max-[640px]:w-[calc(100vw-24px)] sm:max-w-none"
      >
        <DialogTitle className="sr-only">Account settings</DialogTitle>
        <DialogDescription className="sr-only">
          Manage your Misty account, usage, billing, and privacy settings.
        </DialogDescription>

        <DesktopSettingsFrame
          activeId={tab}
          ariaLabel="Account settings"
          description={TAB_DESCRIPTIONS[tab]}
          items={TABS}
          navigationLabel="Account settings sections"
          navigationTitle="Misty account"
          onClose={() => onOpenChange(false)}
          onSelect={setTab}
          presentation="overlay"
          title={activeTab.label}
        >
          {tab === "account" ? (
            me ? (
              <AccountPanel
                me={me}
                onUpdated={renameAccount}
                onAvatarUploaded={bumpAvatarVersion}
                onDeleted={finishDeletion}
              />
            ) : loading ? (
              <div className="flex min-h-40 items-center justify-center gap-2 text-muted-foreground">
                <Spinner aria-hidden="true" className="size-4" />
                <span className="text-sm">Loading account details</span>
              </div>
            ) : (
              <Alert variant="destructive">
                <AlertTitle>Account details are unavailable</AlertTitle>
                <AlertDescription>
                  {loadError || "Close settings and try again in a moment."}
                </AlertDescription>
              </Alert>
            )
          ) : null}

          {tab === "usage" ? (
            <UsagePanel
              usage={usage}
              state={usageState}
              error={usageError}
              onRetry={retryUsage}
            />
          ) : null}

          {tab === "billing" ? (
            <BillingPanel
              me={me}
              usage={usage}
              loading={loading}
              loadError={loadError}
              billingWorking={billingWorking}
              billingError={billingError}
              onBillingAction={openBillingAction}
            />
          ) : null}

          {tab === "privacy" ? <PrivacyPanel /> : null}
        </DesktopSettingsFrame>
      </DialogContent>
    </Dialog>
  );
}
