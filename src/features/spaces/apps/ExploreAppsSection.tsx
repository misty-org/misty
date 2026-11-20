import { useState } from "react";
import {
  AppLogoImage,
  Button,
  EmptyState,
  ErrorState,
  ListRowSkeleton,
  Text,
} from "@misty/ui";
import { AppInstallReviewDialog } from "./AppInstallReviewDialog";
import { catalogApps, catalogLogoUrl, type CatalogApp } from "./thirdPartyApps";
import { useSpaceApps } from "./useSpaceApps";

/** Apps a moderator can install in this Space, kept beside the agent catalog in Explore. */
export function ExploreAppsSection({
  spaceId,
  canManage,
}: {
  spaceId: string;
  canManage: boolean;
}) {
  const { apps, error, reload, install } = useSpaceApps(spaceId);
  const [approving, setApproving] = useState<CatalogApp | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState("");
  const installed = new Set((apps ?? []).map((app) => app.app_id));

  const approve = async () => {
    if (!approving || saving) return;
    setSaving(true);
    setFailure("");
    try {
      await install(approving.id, approving.version, approving.permissions);
      setApproving(null);
    } catch (reason) {
      setFailure(
        reason instanceof Error ? reason.message : `${approving.name} couldn't be added.`,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {error ? (
        <ErrorState
          inline
          title="Apps couldn't load"
          line={error}
          action={{ label: "Try again", variant: "secondary", onClick: reload }}
        />
      ) : null}
      {!apps && !error ? <ListRowSkeleton label="Apps" rows={5} leading lines={2} /> : null}
      {apps && catalogApps.length === 0 ? (
        <EmptyState
          title="No apps to add yet"
          line="Open-source apps from their makers will show up here."
        />
      ) : null}
      {apps && catalogApps.length > 0 ? (
        <div className="grid gap-2">
          {!canManage ? (
            <Text size="meta" tone="muted" wrap>
              A Space moderator can install these apps.
            </Text>
          ) : null}
          {catalogApps.map((app) => (
            <div key={app.id} className="flex items-center gap-3 p-2.5">
              <AppLogoImage src={catalogLogoUrl(app)} name={app.name} size="card" />
              <div className="min-w-0 flex-1">
                <Text tone="bright">{app.name}</Text>
                <Text size="meta" tone="muted" wrap>
                  {app.description ?? `by ${app.maker} · open source`}
                </Text>
              </div>
              {installed.has(app.id) ? (
                <Text size="meta" tone="muted">
                  Installed
                </Text>
              ) : canManage ? (
                <Button variant="secondary" onClick={() => setApproving(app)}>
                  Install
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <AppInstallReviewDialog
        app={approving}
        saving={saving}
        failure={failure}
        onOpenChange={(open) => {
          if (!open) {
            setApproving(null);
            setFailure("");
          }
        }}
        onApprove={() => void approve()}
      />
    </>
  );
}
