import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useBrowserMediaStore, type BrowserMediaInfo } from "@/features/browser/library";
import type { WorkspaceView } from "@/features/workspace/model";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { NowPlayingCard } from "./NowPlayingCard";
import { pictureInPictureSupported } from "@/features/webviews/pictureInPictureSettings";
import { actOnMedia, closeMedia, togglePictureInPicture } from "./useNowPlaying";
import "./nowPlaying.css";

/** One playing tab's media card, wired to its page: controls, mute, and a jump to the tab. */
export function NowPlayingFor(props: {
  view: WorkspaceView;
  info?: BrowserMediaInfo;
  onOpen?: () => void;
  /** Closes the card, such as the breadcrumbs between several sources. */
  footer?: ReactNode;
}) {
  const navigate = useNavigate();
  const paused = useBrowserMediaStore(
    (state) => Boolean(state.paused[props.view.id]) || Boolean(props.info?.paused),
  );
  const muted = useBrowserMediaStore((state) => Boolean(state.muted[props.view.id]));
  return (
    <NowPlayingCard
      view={props.view}
      info={props.info}
      paused={paused}
      muted={muted}
      onAction={(action) => actOnMedia(props.view, action)}
      onToggleMute={() => void useBrowserMediaStore.getState().toggleMuted(props.view.id)}
      onSeek={(seconds) => actOnMedia(props.view, "seekto", seconds)}
      onPictureInPicture={
        pictureInPictureSupported()
          ? () => togglePictureInPicture(props.view, Boolean(props.info?.pictureInPicture))
          : undefined
      }
      pictureInPictureActive={props.info?.pictureInPicture}
      footer={props.footer}
      onClose={() => {
        closeMedia(props.view);
        props.onOpen?.();
      }}
      onOpen={() => {
        props.onOpen?.();
        if (useWorkspaceStore.getState().focusView(props.view.id)) navigate(props.view.route);
      }}
    />
  );
}
