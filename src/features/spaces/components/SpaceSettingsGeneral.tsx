import { SystemErrorNotice } from "@/features/support/systemErrors";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Separator,
} from "@/shared/ui";
import { Trash2 } from "lucide-react";
import type { SpaceSettingsController, SpaceSettingsSpace } from "./useSpaceSettingsController";

export function SpaceSettingsGeneral({
  spaceId,
  space,
  controller,
}: {
  spaceId: string;
  space: SpaceSettingsSpace;
  controller: SpaceSettingsController;
}) {
  const {
    name,
    setName,
    saving,
    saveName,
    error,
    isOwner,
    canRename,
    canLeave,
    canDelete,
    leaveOpen,
    deleteOpen,
    setLeaveOpen,
    setDeleteOpen,
    setDeleteConfirmation,
    clearError,
  } = controller;
  return (
    <div className="grid gap-5">
      <Card aria-labelledby="space-name-heading">
        <CardHeader className="flex flex-row items-start justify-between gap-5">
          <div>
            <CardTitle id="space-name-heading">Space details</CardTitle>
            <p className="mb-0 mt-1 text-xs text-cream-muted">
              The name and access model shown across Misty.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {space.is_default ? <Badge variant="secondary">Default</Badge> : null}
            <Badge variant="outline">{space.is_shared ? "Shared" : "Private"}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <form className="flex max-w-lg gap-2" onSubmit={(event) => void saveName(event)}>
            <Input
              aria-label="Space name"
              maxLength={80}
              disabled={!canRename || saving}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            {canRename ? (
              <Button
                className="shrink-0"
                type="submit"
                disabled={saving || !name.trim() || name.trim() === space.name}
              >
                {saving ? "Saving…" : "Save"}
              </Button>
            ) : null}
          </form>
          {!canRename ? (
            <p className="mb-0 mt-3 text-xs text-cream-muted">
              Only the Space owner can change its name.
            </p>
          ) : null}
          {error && !leaveOpen && !deleteOpen ? (
            <SystemErrorNotice
              error={error}
              scope={`spaces:settings:${spaceId}`}
              title="Space settings need attention"
            />
          ) : null}
          <Separator className="my-5" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Fact label="Members" value={String(space.member_count)} />
            <Fact label="Your role" value={isOwner ? "Owner" : "Member"} />
            <Fact label="Access" value={space.is_shared ? "Shared" : "Private"} />
          </div>
          {space.is_default ? (
            <p className="mb-0 mt-4 text-xs leading-relaxed text-cream-muted">
              This is your default Space. You can rename it and invite people, but it stays with
              your account so you always have a Space available.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {canDelete || canLeave ? (
        <Card className="ring-charcoal-active/20" aria-labelledby="space-danger-heading">
          <CardHeader>
            <CardTitle className="text-cream-bright" id="space-danger-heading">
              Danger zone
            </CardTitle>
            <p className="mb-0 mt-1 text-xs text-cream-muted">
              Actions here can remove access or permanently delete this Space.
            </p>
          </CardHeader>
          <CardContent>
            {canDelete ? (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-sm font-medium">Delete this Space</p>
                  <p className="mb-0 mt-1 text-xs leading-relaxed text-cream-muted">
                    Member access is removed immediately. Permanent deletion follows recovery and
                    storage safety checks.
                  </p>
                </div>
                <Button
                  variant="destructive"
                  type="button"
                  onClick={() => {
                    clearError();
                    setDeleteConfirmation("");
                    setDeleteOpen(true);
                  }}
                >
                  <Trash2 className="size-4" />
                  Delete Space
                </Button>
              </div>
            ) : canLeave ? (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-sm font-medium">Leave this Space</p>
                  <p className="mb-0 mt-1 text-xs leading-relaxed text-cream-muted">
                    You lose access to its chat, notes, drawings, files and code at once, and your
                    agents leave with you.
                  </p>
                </div>
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => {
                    clearError();
                    setLeaveOpen(true);
                  }}
                >
                  Leave Space
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-charcoal-card px-3 py-2.5">
      <span className="block text-[10px] text-cream-muted">{label}</span>
      <span className="mt-0.5 block truncate text-xs font-medium capitalize">{value}</span>
    </div>
  );
}
