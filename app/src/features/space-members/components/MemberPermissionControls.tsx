import { spacesApi } from "@/services/spaces/api";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui";
import { RotateCcw, ShieldCheck } from "lucide-react";
import { useCallback, useState } from "react";

type PermissionEffect = "allow" | "deny" | "inherit";

export function MemberPermissionControls({
  spaceId,
  userId,
  memberName,
}: {
  spaceId: string;
  userId: string;
  memberName: string;
}) {
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingPermission, setSavingPermission] = useState("");
  const [error, setError] = useState("");

  const loadPermissions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await spacesApi.memberPermissions(spaceId, userId);
      setPermissions(result.permissions);
      setLoaded(true);
    } catch {
      setError("Could not load permissions.");
    } finally {
      setLoading(false);
    }
  }, [spaceId, userId]);

  const openPermissions = () => {
    setOpen(true);
    if (!loaded && !loading) void loadPermissions();
  };

  const setPermission = async (permission: string, effect: PermissionEffect) => {
    setSavingPermission(permission);
    setError("");
    try {
      const result = await spacesApi.setMemberPermission(spaceId, userId, permission, effect);
      setPermissions(result.permissions);
    } catch {
      setError("Could not update permissions.");
      await loadPermissions();
    } finally {
      setSavingPermission("");
    }
  };

  const resetDefaults = async () => {
    setSavingPermission("defaults");
    setError("");
    try {
      let latest = permissions;
      for (const group of permissionGroups) {
        for (const item of group.items) {
          latest = (await spacesApi.setMemberPermission(spaceId, userId, item.id, "inherit"))
            .permissions;
        }
      }
      setPermissions(latest);
    } catch {
      setError("Could not restore the Space defaults.");
      await loadPermissions();
    } finally {
      setSavingPermission("");
    }
  };

  const enabledCount = Object.values(permissions).filter(Boolean).length;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!savingPermission || nextOpen) setOpen(nextOpen);
      }}
    >
      <Button
        className="hidden sm:inline-flex"
        size="sm"
        variant="outline"
        type="button"
        onClick={openPermissions}
        aria-label={`Manage permissions for ${memberName}`}
      >
        <ShieldCheck className="size-3.5" />
        Permissions
      </Button>
      <Button
        className="sm:hidden"
        size="icon"
        variant="ghost"
        type="button"
        onClick={openPermissions}
        aria-label={`Manage permissions for ${memberName}`}
      >
        <ShieldCheck className="size-4" />
      </Button>

      <DialogContent className="flex max-h-[min(820px,calc(100vh-32px))] max-w-xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-b border-charcoal-border/60 px-5 py-4 text-left sm:px-6 sm:py-5">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>Permissions for {memberName}</DialogTitle>
            {loaded ? <Badge variant="outline">{enabledCount} enabled</Badge> : null}
          </div>
          <DialogDescription>
            Choose what this member can access. Changes apply immediately.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-auto p-4 sm:p-5">
          {error ? (
            <p
              className="mb-4 mt-0 rounded-lg border border-charcoal-active/25 bg-charcoal-active px-3 py-2 text-xs text-cream-bright"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          {!loaded ? (
            <Card className="grid min-h-56 place-items-center bg-charcoal-card shadow-none ring-0">
              <Button
                variant="outline"
                type="button"
                disabled={loading}
                onClick={() => void loadPermissions()}
              >
                {loading ? "Loading…" : "Try again"}
              </Button>
            </Card>
          ) : (
            <div className="grid items-start gap-3 md:grid-cols-2">
              {permissionGroups.map((group) => (
                <PermissionGroup
                  key={group.title}
                  group={group}
                  permissions={permissions}
                  savingPermission={savingPermission}
                  onSet={setPermission}
                />
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="mt-0 flex-row justify-between gap-3 border-t border-charcoal-border/60 px-4 py-3 sm:px-5">
          <Button
            variant="outline"
            type="button"
            disabled={Boolean(savingPermission) || !loaded}
            onClick={() => void resetDefaults()}
          >
            <RotateCcw className="size-3.5" />
            {savingPermission === "defaults" ? "Restoring…" : "Use Space defaults"}
          </Button>
          <Button type="button" disabled={Boolean(savingPermission)} onClick={() => setOpen(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PermissionGroup({
  group,
  permissions,
  savingPermission,
  onSet,
}: {
  group: (typeof permissionGroups)[number];
  permissions: Record<string, boolean>;
  savingPermission: string;
  onSet: (permission: string, effect: PermissionEffect) => Promise<void>;
}) {
  const enabledCount = group.items.filter((item) => permissions[item.id]).length;

  return (
    <Card className="overflow-hidden">
      <header className="flex min-h-11 items-center justify-between gap-3 border-b border-charcoal-border/60 px-3.5">
        <h3 className="m-0 text-xs font-semibold">{group.title}</h3>
        <Badge variant="secondary">
          {enabledCount}/{group.items.length}
        </Badge>
      </header>
      <div>
        {group.items.map((item) => {
          const blocked = permissionBlockedByParent(permissions, item.id);
          return (
            <label
              className={`flex min-h-[58px] items-center gap-3 border-b border-charcoal-border/60 px-3.5 py-2.5 last:border-0 ${
                blocked ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-charcoal-card"
              }`}
              key={item.id}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium">{item.label}</span>
                <span className="mt-0.5 block text-[10px] leading-relaxed text-cream-muted">
                  {item.description}
                </span>
                {blocked ? (
                  <span className="mt-1 block text-[9px] text-sage-fg">
                    Requires the related parent permission.
                  </span>
                ) : null}
              </span>
              {savingPermission === item.id ? (
                <span className="text-[9px] text-cream-muted">Saving…</span>
              ) : (
                <Checkbox
                  checked={Boolean(permissions[item.id])}
                  disabled={Boolean(savingPermission) || blocked}
                  onCheckedChange={(checked) =>
                    void onSet(item.id, checked === true ? "allow" : "deny")
                  }
                  aria-label={`${item.label} for this member`}
                />
              )}
            </label>
          );
        })}
      </div>
    </Card>
  );
}

function permissionBlockedByParent(permissions: Record<string, boolean>, permission: string) {
  if (permission === "messages.write") return !permissions["messages.read"];
  if (permission === "attachments.upload") {
    return !permissions["messages.read"] || !permissions["messages.write"];
  }
  if (permission === "tasks.manage") return !permissions["tasks.view"];
  return false;
}

const permissionGroups = [
  {
    title: "Chat",
    items: [
      {
        id: "messages.read",
        label: "Read messages",
        description: "Open the shared conversation and download attachments.",
      },
      {
        id: "messages.write",
        label: "Send and manage messages",
        description: "Send, reply, edit, or remove permitted messages.",
      },
      {
        id: "attachments.upload",
        label: "Upload chat attachments",
        description: "Attach new files to Space messages.",
      },
    ],
  },
  {
    title: "Library",
    items: [
      {
        id: "library.view",
        label: "View Library",
        description: "Browse items and metadata in this Space.",
      },
      {
        id: "library.upload",
        label: "Upload files",
        description: "Create uploads in Space storage.",
      },
      {
        id: "library.add",
        label: "Add Library items",
        description: "Add uploaded files and links to the Library.",
      },
      {
        id: "library.edit",
        label: "Organize and edit",
        description: "Edit metadata and Library organization.",
      },
      {
        id: "library.download",
        label: "Copy items",
        description: "Copy Library items to Files or the clipboard.",
      },
      {
        id: "library.import",
        label: "Import items",
        description: "Copy shared items into this Space.",
      },
    ],
  },
  {
    title: "Planner and connections",
    items: [
      {
        id: "tasks.view",
        label: "View tasks and calendars",
        description: "See shared tasks and published events.",
      },
      {
        id: "tasks.manage",
        label: "Manage tasks",
        description: "Create, assign, update, and archive tasks.",
      },
      {
        id: "integrations.manage",
        label: "Manage connections",
        description: "Connect external tools and publish shared resources.",
      },
    ],
  },
  {
    title: "Agents",
    items: [
      {
        id: "agents.run",
        label: "Run Agents",
        description: "Mention, message, or assign active Agents in this Space.",
      },
      {
        id: "agents.manage",
        label: "Manage Agents",
        description: "Add, disable, configure, remove, and approve Agent versions.",
      },
    ],
  },
  {
    title: "Storage",
    items: [
      {
        id: "storage.view_own_usage",
        label: "View own storage usage",
        description: "See storage attributed to this member.",
      },
      {
        id: "storage.view_member_usage",
        label: "View member storage usage",
        description: "See storage attributed to other members.",
      },
      {
        id: "storage.manage",
        label: "Manage storage",
        description: "Manage Space-wide storage and recovery.",
      },
    ],
  },
] as const;
