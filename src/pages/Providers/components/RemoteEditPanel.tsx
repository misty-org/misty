import type { RemoteEditPanelProps } from "@/models/interfaces/pages/Providers/components/RemoteEditPanel";
export type { RemoteEditPanelProps } from "@/models/interfaces/pages/Providers/components/RemoteEditPanel";
import { Alert, AlertDescription, AlertTitle } from "@/ui";
import { Button } from "@/ui";
import { Skeleton } from "@/ui";
import { iconAssets } from "@/assets/icons";
import { AssetIcon } from "@/ui";
import { Panel, PanelHeader } from "@/pages/Providers/components/ProviderPanel";
import { RemoteConfigForm } from "./RemoteConfigForm";
import { RemoteEditActions } from "./RemoteEditActions";
import { EmptyState, ErrorState } from "@/ui";
import { StatusBadge } from "@/ui";

const remoteEditPanelClass =
  "grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden !rounded-none !border-0 !bg-transparent !shadow-none [border-radius:0]";

const remoteEditBodyClass = "min-h-0 overflow-auto";

export function RemoteEditPanel(props: RemoteEditPanelProps) {
  const { draft } = props;
  const loading = Boolean(props.loadingRemoteName);

  return (
    <Panel className={remoteEditPanelClass}>
      <PanelHeader
        title="Edit Remote"
        subtitle={
          loading
            ? `Loading ${props.loadingRemoteName}`
            : draft
              ? `${draft.providerType} · ${draft.originalName}`
              : "Select a remote"
        }
        actions={
          <>
            {!loading && props.stale ? (
              <StatusBadge status="danger" dot>
                Stale
              </StatusBadge>
            ) : null}
            {!loading && props.dirty ? (
              <StatusBadge status="warning" dot>
                Unsaved
              </StatusBadge>
            ) : null}
          </>
        }
      />

      <div className={remoteEditBodyClass}>
        {loading ? (
          <RemoteEditSkeleton />
        ) : draft ? (
          <>
            {props.stale ? (
              <Alert
                variant="destructive"
                className="max-w-[760px] rounded-none border-x-0 border-t-0"
              >
                <AlertTitle>This remote changed in another pane</AlertTitle>
                <AlertDescription className="flex items-center justify-between gap-3">
                  <span>Reload before saving.</span>
                  <Button
                    className="shrink-0"
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={props.onReload}
                    disabled={props.working}
                  >
                    Reload
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            <RemoteConfigForm
              draft={draft}
              configKeys={props.configKeys}
              workflow={props.workflow}
              configPaths={props.configPaths}
              tokenVisible={props.tokenVisible}
              onDraftName={props.onDraftName}
              onConfigField={props.onConfigField}
              onTokenField={props.onTokenField}
              onTokenVisible={props.onTokenVisible}
            />
            <RemoteEditActions
              working={props.working}
              dirty={props.dirty}
              validRemoteName={props.validRemoteName}
              stale={props.stale}
              onSave={props.onSave}
              onDelete={() => props.onDelete(draft.originalName)}
              onTest={props.onTest}
            />
            {props.feedbackError || props.feedbackMessage ? (
              <Alert
                className="mx-[18px] mb-[18px] max-w-[760px]"
                variant={props.feedbackError ? "destructive" : "default"}
              >
                <AlertDescription>{props.feedbackError ?? props.feedbackMessage}</AlertDescription>
              </Alert>
            ) : null}
          </>
        ) : props.serviceError ? (
          <ErrorState
            compact
            title="Remote service unavailable"
            description="Start the Misty remote service, then refresh Remotes."
          />
        ) : (
          <EmptyState
            compact
            title="Select a remote"
            description="Choose a remote to view and edit its provider configuration."
          />
        )}
      </div>
    </Panel>
  );
}

function RemoteEditSkeleton() {
  return (
    <div
      className="grid max-w-[760px] gap-3.5 p-[18px]"
      aria-busy="true"
      aria-label="Loading remote configuration"
    >
      <div className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
        <AssetIcon className="animate-spin" src={iconAssets.sync16} size={17} />
        <span>Loading remote configuration</span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-[68px]" />
        <Skeleton className="h-[68px]" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-[68px]" />
        <Skeleton className="h-[68px]" />
      </div>
      <Skeleton className="h-24" />
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-[68px]" />
        <Skeleton className="h-[68px]" />
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2.5">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    </div>
  );
}
