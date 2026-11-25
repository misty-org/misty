import { Crown, Link2, LogOut, ShieldCheck, UserPlus, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  MenuCheckItem,
  MenuItem,
  MenuSeparator,
  MenuSubmenu,
  PersonRow,
  RoleDot,
  RowGroupSection,
  RowGroupStack,
  SearchField,
  SkeletonList,
  Text,
  notify,
  useConfirmDelete,
} from "@misty/ui";
import { useAuth } from "@/features/account";
import { useNow } from "@/shared/hooks/use_now";
import { spacesApi } from "../api/api";
import type { Space, SpaceInvitation, SpaceMember, SpaceRoleDef } from "../api/dto/entities";
import { useSpacesStore } from "../list/use_spaces_store";
import { canManageSpaceLifecycle } from "../routes/default_space";
import { spaceCan, useSpaceRoles } from "../roles/use_space_roles";
import { InviteDialog } from "./InviteDialog";
import { avatarOutline } from "@/shared/lib/avatar_decoration";
import { PersonFace } from "./PersonFace";
import { SpaceSettingsFrame, type SpaceSettingsNav } from "./SpaceSettingsFrame";
import {
  expiresLine,
  invitationName,
  reloadSpaceInvitations,
  useSpaceInvitations,
} from "./space_people";

export function PeoplePage({ nav }: { nav: SpaceSettingsNav }) {
  const { space } = nav;
  const { user } = useAuth();
  const members = useSpacesStore((state) => state.membersBySpace[space.id]);
  const roles = useSpaceRoles(space.id);
  const canInvite = spaceCan(space, "space.invite");
  const invitations = useSpaceInvitations(space.id, canInvite);
  const [query, setQuery] = useState("");
  const [inviting, setInviting] = useState(false);
  const [transferTo, setTransferTo] = useState<SpaceMember | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirmDelete();
  const now = useNow();

  useEffect(() => {
    if (!members)
      void useSpacesStore
        .getState()
        .loadMembers(space.id)
        .catch(() => undefined);
  }, [members, space.id]);

  const needle = query.trim().toLowerCase();
  const shownMembers = (members ?? []).filter(
    (member) => !needle || member.name.toLowerCase().includes(needle),
  );
  const shownInvitations = (invitations.data ?? []).filter(
    (invitation) => !needle || invitationName(invitation).toLowerCase().includes(needle),
  );

  const remove = (member: SpaceMember) =>
    void confirm({
      title: `Remove ${member.name}?`,
      what: "They lose access now. Their private things here are deleted; what they shared stays.",
      confirmLabel: "Remove",
      onConfirm: () => useSpacesStore.getState().removeMember(space.id, member.user_id),
    });

  const cancelInvitation = (invitation: SpaceInvitation) =>
    void spacesApi
      .revokeInvitation(space.id, invitation.id)
      .then(() => reloadSpaceInvitations(space.id))
      .catch(() =>
        notify({ message: "The invitation couldn't be cancelled. Try again.", tone: "error" }),
      );

  const copyNewLink = (invitation: SpaceInvitation) =>
    void spacesApi
      .resendInvitation(space.id, invitation.id)
      .then(async (refreshed) => {
        if (refreshed.link) await navigator.clipboard?.writeText(refreshed.link);
        notify({ message: "Invitation link copied" });
        await reloadSpaceInvitations(space.id);
      })
      .catch(() => notify({ message: "A new link couldn't be made. Try again.", tone: "error" }));

  return (
    <SpaceSettingsFrame
      nav={nav}
      title="People"
      actions={
        <>
          <SearchField
            aria-label="Search people"
            placeholder="Search"
            containerClassName="w-56"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {canInvite ? (
            <Button variant="primary" icon={UserPlus} onClick={() => setInviting(true)}>
              Invite people
            </Button>
          ) : null}
        </>
      }
    >
      <RowGroupStack>
        {shownInvitations.length ? (
          <RowGroupSection title="Invitations" count={shownInvitations.length}>
            {shownInvitations.map((invitation) => (
              <PersonRow
                key={invitation.id}
                face={
                  <PersonFace
                    id={invitation.invited_user_id ?? invitation.id}
                    name={invitationName(invitation)}
                    noPresence
                  />
                }
                name={invitationName(invitation)}
                line={expiresLine(invitation.expires_at, now)}
                menu={
                  <>
                    {invitation.by_account ? null : (
                      <MenuItem
                        icon={Link2}
                        label="Copy a new link"
                        onSelect={() => copyNewLink(invitation)}
                      />
                    )}
                    <MenuItem
                      icon={XCircle}
                      label="Cancel invitation"
                      onSelect={() => cancelInvitation(invitation)}
                    />
                  </>
                }
              />
            ))}
          </RowGroupSection>
        ) : null}
        {!members ? (
          <RowGroupSection title="Members">
            <SkeletonList
              label="Loading members"
              rows={Math.min(Math.max(space.member_count ?? 4, 1), 8)}
              leading="avatar"
              lines={2}
            />
          </RowGroupSection>
        ) : shownMembers.length ? (
          <RowGroupSection title="Members" count={shownMembers.length}>
            {shownMembers.map((member) => (
              <MemberPerson
                key={member.user_id}
                space={space}
                member={member}
                myRoleIds={members.find((item) => item.user_id === user?.id)?.role_ids}
                roles={roles ?? []}
                me={member.user_id === user?.id}
                onRemove={remove}
                onTransfer={setTransferTo}
              />
            ))}
          </RowGroupSection>
        ) : (
          <EmptyState inline title="Nobody by that name" line="Try another name." />
        )}
      </RowGroupStack>
      {canInvite ? <InviteDialog space={space} open={inviting} onOpenChange={setInviting} /> : null}
      <TransferDialog space={space} member={transferTo} onClose={() => setTransferTo(null)} />
      {confirmDialog}
    </SpaceSettingsFrame>
  );
}

function memberLine(member: SpaceMember, roles: SpaceRoleDef[], me: boolean) {
  const named =
    member.role === "owner"
      ? ["Owner"]
      : roles
          .filter((role) => !role.is_default && member.role_ids?.includes(role.id))
          .sort((left, right) => right.position - left.position)
          .map((role) => role.name);
  const line = named.length ? named.join(", ") : "Member";
  return me ? `${line}, you` : line;
}

function MemberPerson(props: {
  space: Space;
  member: SpaceMember;
  myRoleIds: string[] | undefined;
  roles: SpaceRoleDef[];
  me: boolean;
  onRemove: (member: SpaceMember) => void;
  onTransfer: (member: SpaceMember) => void;
}) {
  const { space, member, me } = props;
  const owner = member.role === "owner";
  const custom = props.roles.filter((role) => !role.is_default);
  const above = space.role === "owner" || spaceCan(space, "administrator");
  const myTop = Math.max(
    0,
    ...custom.filter((role) => props.myRoleIds?.includes(role.id)).map((role) => role.position),
  );
  const canRoles = spaceCan(space, "roles.manage") && custom.length > 0;
  const canTransfer =
    !owner && space.role === "owner" && canManageSpaceLifecycle(space, "transfer");
  const canRemove = !owner && !me && spaceCan(space, "members.remove");

  const toggle = (roleId: string, on: boolean) => {
    const current = member.role_ids ?? [];
    const next = on ? [...new Set([...current, roleId])] : current.filter((id) => id !== roleId);
    void spacesApi
      .setMemberRoles(space.id, member.user_id, next)
      .then(() => useSpacesStore.getState().loadMembers(space.id))
      .catch(() =>
        notify({ message: `${member.name}'s roles couldn't be changed.`, tone: "error" }),
      );
  };

  const menu =
    canRoles || canTransfer || canRemove ? (
      <>
        {canRoles ? (
          <MenuSubmenu icon={ShieldCheck} label="Roles" width="sm">
            {custom.map((role) => (
              <MenuCheckItem
                key={role.id}
                icon={<RoleDot color={role.color} />}
                label={role.name}
                checked={Boolean(member.role_ids?.includes(role.id))}
                disabled={!above && role.position >= myTop}
                reason="Only roles below your own can be given"
                onCheckedChange={(on) => toggle(role.id, on)}
              />
            ))}
          </MenuSubmenu>
        ) : null}
        {canRoles && (canTransfer || canRemove) ? <MenuSeparator /> : null}
        {canTransfer ? (
          <MenuItem icon={Crown} label="Make owner" onSelect={() => props.onTransfer(member)} />
        ) : null}
        {canRemove ? (
          <MenuItem
            icon={LogOut}
            label="Remove from Space"
            danger
            onSelect={() => props.onRemove(member)}
          />
        ) : null}
      </>
    ) : undefined;

  return (
    <PersonRow
      face={
        <PersonFace
          id={member.user_id}
          name={member.name}
          pictureVersion={member.avatar_version}
          outline={avatarOutline(member.avatar_decoration)}
          me={me}
        />
      }
      name={member.name}
      owner={owner}
      line={memberLine(member, props.roles, me)}
      menu={menu}
    />
  );
}

function TransferDialog(props: { space: Space; member: SpaceMember | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const member = props.member;
  const transfer = async () => {
    if (!member || busy) return;
    setBusy(true);
    try {
      await useSpacesStore.getState().transferOwner(props.space.id, member.user_id);
      props.onClose();
    } catch {
      notify({ message: "Ownership wasn't moved. Try again.", tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={Boolean(member)} onOpenChange={(open) => !open && !busy && props.onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{`Make ${member?.name ?? ""} the owner?`}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Text as="p" size="control" tone="muted" wrap>
            {`You stay in ${props.space.name} as a member.`}
          </Text>
        </DialogBody>
        <DialogFooter>
          <Button variant="quiet" size="lg" disabled={busy} onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="lg" disabled={busy} onClick={() => void transfer()}>
            Make owner
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
