import { NowPlayingFor } from "./NowPlayingFor";
import { useMediaInfo, usePlayingViews } from "./useNowPlaying";

/**
 * The vertical sidebar's media player: a card for each tab that is playing sound, between the
 * tabs and the foot, with the page's title and artwork, position, and controls. Nothing shows
 * while nothing plays.
 */
export function SidebarNowPlaying() {
  const playing = usePlayingViews();
  const info = useMediaInfo(playing, playing.length > 0);
  if (!playing.length) return null;
  return (
    <div className="misty-sidebar-now-playing" data-misty-window-drag-block="true">
      {playing.map((view) => (
        <NowPlayingFor key={view.id} view={view} info={info[view.id]} />
      ))}
    </div>
  );
}
