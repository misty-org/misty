import { NowPlayingCrumbs, useChosenSource } from "./NowPlayingCrumbs";
import { NowPlayingFor } from "./NowPlayingFor";
import { useMediaInfo, usePlayingViews } from "./useNowPlaying";

/**
 * The vertical sidebar's media player: one card for whichever tab that is playing sound you have
 * chosen, between the tabs and the foot, with the page's title and artwork, position, and
 * controls. With several sources, breadcrumbs at the card's foot, dots between arrows, switch
 * between them. Nothing shows while nothing plays.
 */
export function SidebarNowPlaying() {
  const playing = usePlayingViews();
  const info = useMediaInfo(playing, playing.length > 0);
  const { index, current, choose } = useChosenSource(playing);
  if (!current) return null;
  return (
    <div className="misty-sidebar-now-playing" data-misty-window-drag-block="true">
      {/* Not keyed by source: the card and its breadcrumbs stay mounted, so the dots and the open
          pill animate as you switch instead of being rebuilt each time. */}
      <NowPlayingFor
        view={current}
        info={info[current.id]}
        footer={<NowPlayingCrumbs sources={playing} index={index} onChoose={choose} />}
      />
    </div>
  );
}
