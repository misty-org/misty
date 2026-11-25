import { BellOff, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useAuth } from "@/features/account";
import type { WorkspaceView } from "@/features/app-windows";
import {
  dmName,
  dmOthers,
  dmPath,
  friendsRoute,
  useDmListUpdates,
  useDms,
  useFriends,
  usePresence,
  type DirectConversation,
} from "@/features/direct";
import { ChatAvatar, useMemberPicture } from "@/features/spaces";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  CountMark,
  ErrorState,
  IconButton,
  MenuCheckItem,
  NavGroupHeading,
  NavRow,
  NavRowLabel,
  PresenceFace,
  RowTools,
  Skeleton,
  spaceIcons,
} from "@misty/ui";
import { noticesMuted, useMessageNotices, useMuted } from "@/shared/lib/message_notices";
import { toggleSection, useCollapsedSections } from "./collapsed_sections";
import { openWorkspaceRoute } from "./space_navigation";
import { SidebarShortcut } from "./SidebarRow";
import { chatSectionClass, faceSlotClass, markSlotClass } from "./styles";
import { avatarOutline } from "@/shared/lib/avatar_decoration";

const FriendsIcon = spaceIcons.friends;

function RowCount({ count, label }: { count: number; label: string }) {
  return <CountMark count={count} label={`${count} ${label}`} />;
}

function DmRowMenu({ dmId, children }: { dmId: string; children: ReactNode }) {
  const mute = useMuted(dmId, dmId);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <MenuCheckItem
          icon={BellOff}
          label="Mute conversation"
          checked={mute.muted}
          closeOnSelect
          onCheckedChange={mute.toggle}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function DmFace({ dm, myUserId }: { dm: DirectConversation; myUserId: string | undefined }) {
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
  return dm.kind === "direct" ? (
    <PresenceFace presence={presence} face="sm">
      {face}
    </PresenceFace>
  ) : (
    face
  );
}

function DmRowSkeletons() {
  return (
    <>
      {Array.from({ length: 3 }, (_, index) => (
        <NavRow key={index} still aria-hidden="true">
          <Skeleton className="size-7 rounded-full" />
          <Skeleton className="h-3 w-28" />
        </NavRow>
      ))}
    </>
  );
}

export function FriendsRow({
  route,
  onOpen,
}: {
  route: string;
  onOpen(view: WorkspaceView): void;
}) {
  const friends = useFriends();
  const incoming = friends.data?.incoming.length ?? 0;
  return (
    <NavRow
      current={route.split("?")[0] === friendsRoute}
      onClick={() => openWorkspaceRoute(friendsRoute, onOpen)}
    >
      <span className={markSlotClass}>
        <FriendsIcon aria-hidden="true" />
      </span>
      <NavRowLabel bright={incoming > 0} className="flex-1">
        Friends
      </NavRowLabel>
      {incoming > 0 ? (
        <RowCount count={incoming} label="friend requests" />
      ) : (
        <SidebarShortcut command="app.open_friends" />
      )}
    </NavRow>
  );
}

export function PersonalSections({
  route,
  onOpen,
  agents,
}: {
  route: string;
  onOpen(view: WorkspaceView): void;
  agents?: ReactNode;
}) {
  useDmListUpdates();
  const { user } = useAuth();
  const dms = useDms();
  const notices = useMessageNotices((state) => state.value);
  const collapsed = useCollapsedSections((state) => state.value);
  const dmsOpen = !collapsed.includes("dms");
  const path = route.split("?")[0];
  const open = (target: string) => openWorkspaceRoute(target, onOpen);

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
              (dms.data ?? []).map((dm) => {
                const muted = noticesMuted(notices, dm.id);
                const unread = muted ? 0 : dm.unread_count;
                const target = dmPath(dm.id);
                return (
                  <DmRowMenu key={dm.id} dmId={dm.id}>
                    <NavRow current={path === target} muted={muted} onClick={() => open(target)}>
                      <span className={faceSlotClass}>
                        <DmFace dm={dm} myUserId={user?.id} />
                      </span>
                      <NavRowLabel bright={unread > 0} className="flex-1">
                        {dmName(dm, user?.id)}
                      </NavRowLabel>
                      <RowCount count={unread} label="unread" />
                    </NavRow>
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
