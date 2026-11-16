import { Gamepad2, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  EmptyState,
  IconButton,
  OverflowFadeText,
  Pressable,
  rowShape,
  Skeleton,
  Surface,
  Text,
  cn,
} from "@/shared/ui";
import { spacesGateway } from "../spaces-gateway/spacesGateway";
import { useSpaceGames, type SpaceGame } from "./useStudioProgress";

/**
 * The arcade cabinet's screen: the games the Space's agents made, and the one picked playing in a
 * sealed frame, which runs its own scripts but can reach nothing of Misty's or the person's.
 * Games are single HTML pages in the Space Library tagged "game"; an agent saves one there when
 * asked to make a game.
 */
export function ArcadePanel(props: { spaceId: string; onClose(): void }) {
  const { spaceId } = props;
  const games = useSpaceGames((state) => state.bySpace[spaceId]);
  const loading = useSpaceGames((state) => state.loading[spaceId] ?? false);
  const [playing, setPlaying] = useState<SpaceGame | null>(null);
  const [page, setPage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  /** Bumped by Restart, which loads the game afresh. */
  const [round, setRound] = useState(0);

  useEffect(() => void useSpaceGames.getState().load(spaceId), [spaceId]);
  useEffect(() => {
    if (!playing && games?.length) setPlaying(games[0]!);
  }, [games, playing]);
  useEffect(() => {
    const gateway = spacesGateway.maybe();
    if (!playing || !gateway) return;
    let active = true;
    setPage(null);
    setFailed(false);
    gateway
      .gameHtml(spaceId, playing.id)
      .then((html) => active && setPage(html))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [spaceId, playing]);

  return (
    <Surface
      as="section"
      tone="scene-panel"
      radius="2xl"
      aria-label="Arcade"
      className="absolute inset-4 z-[var(--stack-overlay)] mx-auto flex max-w-240 flex-col gap-2 p-3"
      onKeyDown={(event) => {
        if (event.key === "Escape") props.onClose();
      }}
    >
      <header className="flex h-8 flex-none items-center gap-2 pl-1">
        <Text bare tone="bright" className="grid size-5 place-items-center">
          <Gamepad2 aria-hidden="true" />
        </Text>
        <Text as="h3" tone="bright" className="flex min-w-0 flex-1 text-sm font-medium">
          <OverflowFadeText>{playing ? playing.name : "Arcade"}</OverflowFadeText>
        </Text>
        {playing ? (
          <IconButton label="Restart" onClick={() => setRound((known) => known + 1)}>
            <RotateCcw aria-hidden="true" />
          </IconButton>
        ) : null}
        <IconButton label="Close" onClick={props.onClose}>
          <X aria-hidden="true" />
        </IconButton>
      </header>
      <div className="flex min-h-0 flex-1 gap-2">
        {games && games.length > 1 ? (
          <nav
            aria-label="Games"
            className="grid w-52 flex-none content-start gap-0.5 overflow-y-auto"
          >
            {games.map((game) => (
              <Pressable
                key={game.id}
                wash="control"
                selected={playing?.id === game.id}
                aria-current={playing?.id === game.id || undefined}
                className={cn(rowShape, "w-full text-meta")}
                onClick={() => setPlaying(game)}
              >
                <Gamepad2 aria-hidden="true" />
                <OverflowFadeText className="min-w-0 flex-1 text-left">{game.name}</OverflowFadeText>
              </Pressable>
            ))}
          </nav>
        ) : null}
        <Surface tone="page" radius="lg" className="relative min-h-0 flex-1 overflow-hidden">
          {!games && loading ? (
            <Skeleton className="absolute inset-0" />
          ) : !games?.length ? (
            <EmptyState
              title="No games yet"
              line="Ask one of your agents to make a game. It lands here once it's saved."
            />
          ) : failed ? (
            <EmptyState title="Couldn't load this game" />
          ) : page === null ? (
            <Skeleton className="absolute inset-0" />
          ) : (
            <iframe
              key={`${playing?.id}:${round}`}
              title={playing?.name ?? "Game"}
              srcDoc={page}
              // Its own scripts and nothing else: no Misty origin, no forms, no pop-ups.
              sandbox="allow-scripts allow-pointer-lock"
              className="absolute inset-0 size-full border-0 bg-white"
            />
          )}
        </Surface>
      </div>
    </Surface>
  );
}
