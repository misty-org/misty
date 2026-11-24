import { Plus, Users } from "lucide-react";
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
  ErrorState,
  IconButton,
  NavGroupHeading,
  NavRow,
  NavRowLabel,
  PresenceFace,
  RowTools,
  Skeleton,
  Text,
} from "@misty/ui";
import { toggleSection, useCollapsedSections } from "./collapsed_sections";
import { openWorkspaceRoute } from "./space_navigation";
import { SidebarShortcut } from "./SidebarRow";
import { chatSectionClass, faceSlotClass, markSlotClass } from "./styles";

function RowCount({ count, label }: { count: number; label: string }) {
  return count > 0 ? (
    <Text size="caption" tone="chrome" aria-label={`${count} ${label}`}>
      {count}
    </Text>
  ) : null;
}

function DmFace({ dm, myUserId }: { dm: DirectConversation; myUserId: string | undefined }) {
  const other = dmOthers(dm, myUserId)[0];
  const presence = usePresence(dm.kind === "direct" ? other?.user_id : undefined);
  const picture = useMemberPicture(other?.user_id ?? "", other?.avatar_version ?? 0);
  if (!other) return null;
  const face = (
    <ChatAvatar id={other.user_id} name={other.username} src={picture ?? undefined} size="sm" />
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
          <Skeleton className="size-6 rounded-full" />
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
        <Users aria-hidden="true" />
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
}: {
  route: string;
  onOpen(view: WorkspaceView): void;
}) {
  useDmListUpdates();
  const { user } = useAuth();
  const dms = useDms();
  const collapsed = useCollapsedSections((state) => state.value);
  const dmsOpen = !collapsed.includes("dms");
  const path = route.split("?")[0];
  const open = (target: string) => openWorkspaceRoute(target, onOpen);

  return (
    <>
      <section className={chatSectionClass} aria-label="Direct messages" data-tour="sidebar-dms">
        <NavGroupHeading
          name="Direct messages"
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
                const unread = dm.unread_count;
                const target = dmPath(dm.id);
                return (
                  <NavRow key={dm.id} current={path === target} onClick={() => open(target)}>
                    <span className={faceSlotClass}>
                      <DmFace dm={dm} myUserId={user?.id} />
                    </span>
                    <NavRowLabel bright={unread > 0} className="flex-1">
                      {dmName(dm, user?.id)}
                    </NavRowLabel>
                    <RowCount count={unread} label="unread" />
                  </NavRow>
                );
              })
            )}
          </>
        ) : null}
      </section>
    </>
  );
}
