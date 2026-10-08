import { lazy, useMemo } from "react";
import { useAuth } from "@/features/auth";
import { useSpacesStore } from "@/features/spaces";
import { SystemErrorNotice, reportSystemError } from "@/features/support/systemErrors";
import { useAiSurfaceAdapter } from "@/features/ai-surface/AiPaneHost";
import type { AiSurfaceAdapter } from "@/features/ai-surface/types";
import { useWorkspaceViewTitle } from "@/features/workspace";
import { usePinnedIds } from "@/shared/hooks/usePinnedIds";
import { useSpaceDrawings } from "./hooks/useSpaceDrawings";
import { useDrawingRoom } from "./hooks/useDrawingRoom";
import { DrawingHeader } from "./components/DrawingHeader";
import { DrawingPreviewHeader } from "./components/DrawingPreviewHeader";
import { DrawingPreview } from "./components/DrawingPreview";
import { NewDrawingDialog } from "./components/NewDrawingDialog";
import { SpaceDrawingsView, type DrawingsViewRuntime } from "./SpaceDrawingsView";
const Canvas = lazy(() => import("./components/CollaborativeDrawingCanvas"));
const emptyMembers: never[] = [];
function Title({ title, tab }: { title: string; tab?: string }) {
  useWorkspaceViewTitle(tab, title);
  return null;
}
function AI({ adapter }: { adapter: AiSurfaceAdapter }) {
  useAiSurfaceAdapter(adapter);
  return null;
}
export function SpaceDrawings(props: {
  spaceId: string;
  drawingId: string;
  workspaceTabId?: string;
}) {
  const { user } = useAuth();
  const readOnly = useSpacesStore((state) => state.referenceOnly);
  const members = useSpacesStore((state) => state.membersBySpace[props.spaceId] ?? emptyMembers);
  const runtime = useMemo<DrawingsViewRuntime>(
    () => ({
      user,
      readOnly,
      members,
      useList: useSpaceDrawings,
      useRoom: (space, id, _user, options) => useDrawingRoom(space, id, user!, options),
      usePins: (key, ids, loading) => usePinnedIds(window.localStorage, key, ids, loading),
      renderTitle: (title, tab) => <Title title={title} tab={tab} />,
      renderAiRegistration: (adapter) => <AI adapter={adapter} />,
      renderError: (error, scope, title) => (
        <SystemErrorNotice error={error} scope={scope} title={title} />
      ),
      Header: (props) => <DrawingHeader {...props} reportError={reportSystemError} />,
      PreviewHeader: (props) => <DrawingPreviewHeader {...props} reportError={reportSystemError} />,
      Preview: (preview) => <DrawingPreview {...preview} user={user!} />,
      NewDialog: (props) => <NewDrawingDialog {...props} reportError={reportSystemError} />,
      Canvas,
    }),
    [user, members, readOnly],
  );
  return <SpaceDrawingsView {...props} runtime={runtime} />;
}
