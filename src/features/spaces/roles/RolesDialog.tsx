import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  ListRow,
  MenuItem,
  RoleDot,
  SectionHeading,
  useNotice,
} from "@misty/ui";
import { useAuth } from "@/features/account";
import { spacesApi } from "../api/api";
import type { RoleInput, Space, SpaceRoleDef } from "../api/dto/entities";
import { useSpacesStore } from "../list/useSpacesStore";
import { RoleEditor } from "./RoleEditor";
import { spaceCan, useSpaceRoles, useSpaceRolesStore } from "./useSpaceRoles";

/**
 * The Space's roles, after Discord's Roles settings: the list top first with `everyone` last,
 * and the picked role's editor beside it. A person edits only the roles below their own highest
 * one; the owner and administrators edit them all.
 */
export function RolesDialog(props: {
  space: Space;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { space } = props;
  const roles = useSpaceRoles(space.id);
  const members = useSpacesStore((state) => state.membersBySpace[space.id]);
  const { user } = useAuth();
  const me = members?.find((member) => member.user_id === user?.id);
  const [pickedId, setPickedId] = useState("");
  const [deleting, setDeleting] = useState<SpaceRoleDef | null>(null);
  const [error, setError] = useState("");
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  useEffect(() => {
    if (props.open && !members) void useSpacesStore.getState().loadMembers(space.id);
  }, [members, props.open, space.id]);

  const above = space.role === "owner" || spaceCan(space, "administrator");
  const myTop = useMemo(
    () =>
      Math.max(
        0,
        ...(roles ?? [])
          .filter((role) => me?.role_ids?.includes(role.id))
          .map((role) => role.position),
      ),
    [me, roles],
  );
  const editable = (role: SpaceRoleDef) =>
    above || role.position < myTop || (role.is_default && myTop > 0);
  const picked = roles?.find((role) => role.id === pickedId) ?? roles?.[0];
  const custom = (roles ?? []).filter((role) => !role.is_default);

  const run = async (work: () => Promise<unknown>, failed: string) => {
    try {
      await work();
    } catch {
      setError(failed);
    } finally {
      await useSpaceRolesStore
        .getState()
        .load(space.id)
        .catch(() => undefined);
    }
  };
  const update = (role: SpaceRoleDef, input: RoleInput) => {
    // Shown at once; the server's answer replaces it.
    useSpaceRolesStore.getState().set(
      space.id,
      (roles ?? []).map((item) => (item.id === role.id ? { ...item, ...input } : item)),
    );
    void run(() => spacesApi.updateRole(space.id, role.id, input), "The role couldn't be saved.");
  };
  const create = () =>
    void run(async () => {
      const made = await spacesApi.createRole(space.id, { name: "new role", permissions: [] });
      setPickedId(made.id);
    }, "The role couldn't be made.");
  const move = (role: SpaceRoleDef, by: -1 | 1) => {
    const order = custom.map((item) => item.id);
    const from = order.indexOf(role.id);
    const to = from + by;
    if (to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to]!, order[from]!];
    void run(() => spacesApi.reorderRoles(space.id, order), "The roles couldn't be reordered.");
  };
  const setMember = (role: SpaceRoleDef, userId: string, has: boolean) => {
    const member = members?.find((item) => item.user_id === userId);
    const current = member?.role_ids ?? [];
    const next = has ? [...new Set([...current, role.id])] : current.filter((id) => id !== role.id);
    void run(async () => {
      await spacesApi.setMemberRoles(space.id, userId, next);
      await useSpacesStore.getState().loadMembers(space.id);
    }, "That person's roles couldn't be changed.");
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Roles</DialogTitle>
        </DialogHeader>
        <div className="mt-4 flex h-[min(--spacing(144),70vh)] min-h-0 gap-6">
          <nav aria-label="Roles" className="flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto">
            <SectionHeading
              title="Roles"
              count={custom.length}
              action={
                spaceCan(space, "roles.manage")
                  ? { label: "New role", icon: Plus, onSelect: create }
                  : undefined
              }
            />
            {(roles ?? []).map((role) => (
              <ListRow
                key={role.id}
                label={role.is_default ? "@everyone" : role.name}
                leading={<RoleDot color={role.color} />}
                selected={picked?.id === role.id}
                onOpen={() => setPickedId(role.id)}
                menuLabel={`More for ${role.name}`}
                menu={
                  !role.is_default && editable(role) ? (
                    <>
                      <MenuItem icon={ArrowUp} label="Move up" onSelect={() => move(role, -1)} />
                      <MenuItem icon={ArrowDown} label="Move down" onSelect={() => move(role, 1)} />
                      <MenuItem icon={Trash2} label="Delete" onSelect={() => setDeleting(role)} />
                    </>
                  ) : undefined
                }
              />
            ))}
          </nav>
          {picked ? (
            <RoleEditor
              role={picked}
              members={members ?? []}
              editable={editable(picked)}
              onChange={(input) => update(picked, input)}
              onMembers={(userId, has) => setMember(picked, userId, has)}
            />
          ) : null}
        </div>
      </DialogContent>
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
          <AlertDialogDescription>Everyone who has it loses it.</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const role = deleting;
                setDeleting(null);
                if (role)
                  void run(
                    () => spacesApi.deleteRole(space.id, role.id),
                    "The role couldn't be deleted.",
                  );
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
