import { KeyRound, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  EmptyState,
  ErrorState,
  ListRow,
  ListRowSkeleton,
  MenuItem,
  MenuSeparator,
  notify,
  useConfirmDelete,
} from "@misty/ui";
import { spacesApi } from "../api/api";
import type { SpaceIntegration } from "../api/dto/entities";
import { integrationsPath } from "../api/integrations";
import { useSpaceResource } from "../api/space_resource";
import { useSpacesStore } from "../list/use_spaces_store";
import { AddIntegrationDialog } from "./AddIntegrationDialog";
import { accessLine } from "./integration_access";
import { IntegrationTokenDialog, type ShownToken } from "./IntegrationTokenDialog";

function refreshMembers(spaceId: string) {
  if (!useSpacesStore.getState().membersBySpace[spaceId]) return;
  void useSpacesStore
    .getState()
    .loadMembers(spaceId)
    .catch(() => undefined);
}

export function SpaceIntegrationsSection({ spaceId }: { spaceId: string }) {
  const listing = useSpaceResource(integrationsPath(spaceId), () =>
    spacesApi.integrations(spaceId),
  );
  const [adding, setAdding] = useState(false);
  const [replacing, setReplacing] = useState<SpaceIntegration | null>(null);
  const [working, setWorking] = useState(false);
  const [shown, setShown] = useState<ShownToken | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirmDelete();
  const integrations = listing.data;

  const added = (integration: SpaceIntegration, token: string) => {
    listing.set((previous) => [...(previous ?? []), integration]);
    setShown({ name: integration.name, token });
    refreshMembers(spaceId);
  };

  const replace = async (integration: SpaceIntegration) => {
    setWorking(true);
    try {
      const { token } = await spacesApi.replaceIntegrationToken(spaceId, integration.id);
      setReplacing(null);
      setShown({ name: integration.name, token });
    } catch {
      notify({
        message: `The token for ${integration.name} couldn't be replaced. Try again.`,
        tone: "error",
      });
    } finally {
      setWorking(false);
    }
  };

  const remove = (integration: SpaceIntegration) =>
    void confirm({
      title: `Remove "${integration.name}"?`,
      what: "Its token stops working and its connections close.",
      confirmLabel: "Remove",
      onConfirm: async () => {
        await spacesApi.removeIntegration(spaceId, integration.id);
        listing.set((previous) => (previous ?? []).filter((item) => item.id !== integration.id));
        refreshMembers(spaceId);
      },
    });

  const hasIntegrations = Boolean(integrations?.length);

  return (
    <div className="grid min-w-0 gap-3">
      {!integrations && !listing.loading && listing.error ? (
        <ErrorState
          inline
          title="Integrations couldn't load"
          line="Try again in a moment."
          action={{ label: "Try again", onClick: () => void listing.reload() }}
        />
      ) : !integrations ? (
        <ListRowSkeleton label="Integrations" rows={2} lines={2} state />
      ) : hasIntegrations ? (
        <div className="grid min-w-0">
          {integrations.map((integration) => (
            <ListRow
              key={integration.id}
              label={integration.name}
              description={accessLine(integration.access, integration.key_prefix) || undefined}
              state={
                integration.last_used_at
                  ? { kind: "time", at: integration.last_used_at }
                  : { kind: "none" }
              }
              menuLabel={`Actions for ${integration.name}`}
              menu={
                <>
                  <MenuItem
                    icon={KeyRound}
                    label="Replace token"
                    onSelect={() => setReplacing(integration)}
                  />
                  <MenuSeparator />
                  <MenuItem
                    icon={Trash2}
                    label="Remove"
                    danger
                    onSelect={() => remove(integration)}
                  />
                </>
              }
            />
          ))}
        </div>
      ) : (
        <EmptyState
          inline
          title="No integrations yet"
          line="An integration lets a bot, a webhook or a server reach this Space's rooms."
          action={{ label: "Add integration", icon: Plus, onClick: () => setAdding(true) }}
        />
      )}
      {hasIntegrations ? (
        <div className="flex justify-end">
          <Button type="button" variant="secondary" icon={Plus} onClick={() => setAdding(true)}>
            Add integration
          </Button>
        </div>
      ) : null}
      <AddIntegrationDialog
        spaceId={spaceId}
        open={adding}
        onOpenChange={setAdding}
        onAdded={added}
      />
      <AlertDialog
        open={replacing !== null}
        onOpenChange={(next) => !next && !working && setReplacing(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{`Replace the token for ${replacing?.name ?? ""}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              The current token stops working and its connections close.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel>
            <Button
              type="button"
              variant="primary"
              size="lg"
              disabled={working}
              onClick={() => replacing && void replace(replacing)}
            >
              Replace
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <IntegrationTokenDialog shown={shown} onClose={() => setShown(null)} />
      {confirmDialog}
    </div>
  );
}
