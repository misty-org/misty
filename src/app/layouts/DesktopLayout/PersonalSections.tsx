import { BellOff, ImageUp, LogOut, Pencil, Plus, Trash2, Undo2, X } from "lucide-react";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/features/account";
import type { WorkspaceView } from "@/features/app-windows";
import type { AgentProfile } from "@/shared/schemas";
import {
  agentDmClosed,
  closeAgentDm,
  closeDm,
  directApi,
  dmClosed,
  dmMembersName,
  dmName,
  dmOthers,
  dmPath,
  friendsRoute,
  GroupFace,
  reloadDms,
  reopenAgentDm,
  renameDm,
  renameGroupDm,
  useDmListUpdates,
  useDmLocal,
  useDms,
  usePresence,
  type DirectConversation,
} from "@/features/direct";
import { ChatAvatar, useGroupPictureEditor, useMemberPicture } from "@/features/spaces";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  CountMark,
  ErrorState,
  IconButton,
  MenuCheckItem,
  MenuItem,
  NavGroupHeading,
  NavRow,
  NavRowLabel,
  notify,
  PresenceFace,
  RenameItemDialog,
  RowTools,
  Skeleton,
  useConfirmDelete,
} from "@misty/ui";
import { noticesMuted, useMessageNotices, useMuted } from "@/shared/lib/message_notices";
import { toggleSection, useCollapsedSections } from "./collapsed_sections";
import { openWorkspaceRoute } from "./space_navigation";
import { chatSectionClass, faceSlotClass } from "./styles";
import { avatarOutline } from "@/shared/lib/avatar_decoration";

function RowCount({ count, label }: { count: number; label: string }) {
  return <CountMark count={count} label={`${count} ${label}`} />;
}

function DmRowMenu({
  dm,
  name,
  renamed,
  myUserId,
  onClose,
  onLeft,
  children,
}: {
  dm: DirectConversation;
  name: string;
  renamed: boolean;
  myUserId: string | undefined;
  onClose(): void;
  onLeft(): void;
  children: ReactNode;
}) {
  const mute = useMuted(dm.id, dm.id, "this conversation");
  const { confirm, dialog } = useConfirmDelete();
  const leave = () =>
    void confirm({
      title: "Leave this group?",
      what: "You stop seeing this group and its messages. Someone can add you back.",
      confirmLabel: "Leave",
      onConfirm: async () => {
        await directApi.leaveDm(dm.id);
        onLeft();
        await reloadDms().catch(() => undefined);
      },
    });
  const remove = () =>
    void confirm({
      title: "Delete this conversation?",
      what: "All its messages are deleted for both of you. This can't be undone.",
      onConfirm: async () => {
        await directApi.deleteDm(dm.id);
        onLeft();
        await reloadDms().catch(() => undefined);
      },
    });
  const [renaming, setRenaming] = useState(false);
  const rename = (next: string) => {
    if (dm.kind !== "group") return renameDm(dm.id, next);
    void renameGroupDm(dm.id, next).catch(() =>
      notify({ message: "The group couldn't be renamed", tone: "error" }),
    );
  };
  const picture = useGroupPictureEditor(dm.id, dm.avatar_version ?? 0, () => {
    void reloadDms().catch(() => undefined);
  });
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent>
          <MenuItem icon={Pencil} label="Rename" onSelect={() => setRenaming(true)} />
          {renamed ? (
            <MenuItem icon={Undo2} label="Use their names" onSelect={() => rename("")} />
          ) : null}
          {dm.kind === "group" ? (
            <MenuItem icon={ImageUp} label="Change picture" onSelect={picture.open} />
          ) : null}
          <MenuCheckItem
            icon={BellOff}
            label="Mute conversation"
            checked={mute.muted}
            closeOnSelect
            onCheckedChange={mute.toggle}
          />
          <MenuItem icon={X} label="Close conversation" onSelect={onClose} />
          {dm.kind === "group" ? (
            <MenuItem icon={LogOut} label="Leave group" danger onSelect={leave} />
          ) : (
            <MenuItem icon={Trash2} label="Delete conversation" danger onSelect={remove} />
          )}
        </ContextMenuContent>
      </ContextMenu>
      {dialog}
      {picture.dialog}
      {renaming ? (
        <RenameItemDialog
          key={dm.id}
          title="Rename conversation"
          initialName={renamed ? name : dmMembersName(dm, myUserId)}
          onConfirm={async (next) => {
            await rename(next === dmMembersName(dm, myUserId) ? "" : next);
            setRenaming(false);
          }}
          onClose={() => setRenaming(false)}
        />
      ) : null}
    </>
  );
}

function DmFace({ dm, myUserId }: { dm: DirectConversation; myUserId: string | undefined }) {
  if (dm.kind === "group") return <GroupFace dm={dm} />;
  return <PersonFace dm={dm} myUserId={myUserId} />;
}

function PersonFace({ dm, myUserId }: { dm: DirectConversation; myUserId: string | undefined }) {
  const other = dmOthers(dm, myUserId)[0];
  const presence = usePresence(dm.kind === "direct" ? other?.user_id : undefined);
  const picture = useMemberPicture(other?.user_id ?? "", other?.avatar_version ?? 0);
  if (!other) return null;
  const face = (
    <ChatAvatar
      id={other.user_id}
      name={other.username}
      src={picture ?? undefined}
      size="sm"
      outline={avatarOutline(other.avatar_decoration)}
    />
  );
  return (
    <PresenceFace presence={presence} face="sm">
      {face}
    </PresenceFace>
  );
}

function DmRowSkeletons() {
  return (
    <>
      {Array.from({ length: 3 }, (_, index) => (
        <NavRow key={index} still face aria-hidden="true">
          <Skeleton className="size-7 rounded-full" />
          <Skeleton className="h-3 w-28" />
        </NavRow>
      ))}
    </>
  );
}

type MixedAgent = { agent: AgentProfile; at: string };

export function PersonalSections({
  route,
  onOpen,
  agents,
  mixedAgents = [],
  renderAgent,
}: {
  route: string;
  onOpen(view: WorkspaceView): void;
  agents?: ReactNode;
  mixedAgents?: MixedAgent[];
  renderAgent?(agent: AgentProfile, onClose: () => void): ReactNode;
}) {
  useDmListUpdates();
  const { user } = useAuth();
  const dms = useDms();
  const local = useDmLocal((state) => state.value);
  useEffect(() => void useDmLocal.getState().load(), []);
  const notices = useMessageNotices((state) => state.value);
  const collapsed = useCollapsedSections((state) => state.value);
  const dmsOpen = !collapsed.includes("dms");
  const [path, query = ""] = route.split("?");
  const open = (target: string) => openWorkspaceRoute(target, onOpen);
  const openAgent = path === "/agents" ? new URLSearchParams(query).get("agent") : null;
  useEffect(() => {
    if (openAgent) reopenAgentDm(openAgent);
  }, [openAgent]);
  const closeAgent = (agent: AgentProfile) => {
    if (openAgent === agent.id) open(friendsRoute);
    closeAgentDm(agent.id);
  };

  return (
    <>
      <section className={chatSectionClass} aria-label="Direct Messages" data-tour="sidebar-dms">
        <NavGroupHeading
          name="Direct Messages"
          collapsible={{ open: dmsOpen, onToggle: () => toggleSection("dms") }}
          className="group/row"
        >
          <RowTools reveal="hover">
            <IconButton label="New direct message" onClick={() => open(friendsRoute)}>
              <Plus />
            </IconButton>
          </RowTools>
        </NavGroupHeading>
        {dmsOpen ? (
          <>
            {dms.error && !dms.data ? (
              <ErrorState
                inline
                title="Direct messages couldn't load"
                line="Check your connection and try again."
                action={{
                  label: "Try again",
                  variant: "secondary",
                  onClick: () => void dms.reload({ force: true }),
                }}
              />
            ) : dms.loading && !dms.data ? (
              <DmRowSkeletons />
            ) : (
              [
                ...(dms.data ?? [])
                  .filter((dm) => !dmClosed(dm, local))
                  .map((dm) => ({
                    at: dm.last_message_at ?? dm.updated_at,
                    dm,
                    agent: undefined,
                  })),
                ...mixedAgents
                  .filter(
                    (item) =>
                      item.agent.id === openAgent || !agentDmClosed(item.agent.id, item.at, local),
                  )
                  .map((item) => ({ at: item.at, dm: undefined, agent: item.agent })),
              ]
                .sort((a, b) => b.at.localeCompare(a.at))
                .map(({ dm, agent }) => {
                  if (agent)
                    return (
                      <Fragment key={`agent:${agent.id}`}>
                        {renderAgent?.(agent, () => closeAgent(agent))}
                      </Fragment>
                    );
                  if (!dm) return null;
                  const muted = noticesMuted(notices, dm.id);
                  const unread = muted ? 0 : dm.unread_count;
                  const target = dmPath(dm.id);
                  const name = dmName(dm, user?.id);
                  const leaveView = () => {
                    if (path === target) open(friendsRoute);
                  };
                  const close = () => {
                    leaveView();
                    closeDm(dm.id);
                  };
                  return (
                    <DmRowMenu
                      key={dm.id}
                      dm={dm}
                      name={name}
                      renamed={Boolean(dm.kind === "group" ? dm.name : local.names[dm.id])}
                      myUserId={user?.id}
                      onClose={close}
                      onLeft={leaveView}
                    >
                      <div className="group/row relative flex flex-col">
                        <NavRow
                          face
                          current={path === target}
                          muted={muted}
                          onClick={() => open(target)}
                        >
                          <span className={faceSlotClass}>
                            <DmFace dm={dm} myUserId={user?.id} />
                          </span>
                          <NavRowLabel bright={unread > 0} className="flex-1">
                            {name}
                          </NavRowLabel>
                          <RowCount count={unread} label="unread" />
                        </NavRow>
                        <RowTools reveal="cover" ground="chrome">
                          <IconButton label="Close conversation" onClick={close}>
                            <X />
                          </IconButton>
                        </RowTools>
                      </div>
                    </DmRowMenu>
                  );
                })
            )}
            {agents}
          </>
        ) : null}
      </section>
    </>
  );
}
