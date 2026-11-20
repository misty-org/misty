import { Pause, Play, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cn,
  IconButton,
  OverflowFadeText,
  Pressable,
  Surface,
  Text,
  rowShapeTwoLine,
} from "@misty/ui";
import { offsetLabel } from "../activity/stepSentences";
import { browserLogApi, type BrowserLogRow } from "./browserLogApi";
import { actionIcon, actionSentence, siteOf, verdictWords } from "./browserLogSentences";
import { BROWSER_LOG_EVENT } from "./recordBrowserLog";

/** How long each picture shows while the log plays back. */
const PLAY_EVERY_MS = 1200;
/** A burst of actions reads the log once, after it. */
const SETTLE_MS = 300;

const pictures = new Map<string, Promise<string>>();

/** An action's picture as a data address, read once per session and kept for the views of it. */
function useLogPicture(runId: string, picture: string): string {
  const [shown, setShown] = useState("");
  useEffect(() => {
    if (!picture) return setShown("");
    let live = true;
    const key = `${runId}/${picture}`;
    let loading = pictures.get(key);
    if (!loading) {
      loading = browserLogApi.picture(runId, picture).catch(() => "");
      pictures.set(key, loading);
      if (pictures.size > 120) pictures.delete(pictures.keys().next().value!);
    }
    void loading.then((address) => live && setShown(address));
    return () => {
      live = false;
    };
  }, [runId, picture]);
  return shown;
}

/** A run's actions, read again whenever one is logged. */
function useLogRows(runId: string): BrowserLogRow[] | null {
  const [rows, setRows] = useState<BrowserLogRow[] | null>(null);
  const read = useCallback(() => {
    void browserLogApi
      .rows(runId)
      .then(setRows)
      .catch(() => setRows((current) => current ?? []));
  }, [runId]);
  useEffect(() => {
    setRows(null);
    read();
    let timer = 0;
    const logged = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(read, SETTLE_MS);
    };
    window.addEventListener(BROWSER_LOG_EVENT, logged);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(BROWSER_LOG_EVENT, logged);
    };
  }, [read]);
  return rows;
}

function Figure({ children }: { children: React.ReactNode }) {
  return (
    <Text bare size="caption" tone="muted" className="shrink-0 tabular-nums">
      {children}
    </Text>
  );
}

/**
 * A run's browser log: every action the agent took in its tabs, oldest first, each with the page
 * it was on and what it did there, and the page as it was after the chosen action above the list.
 * The log plays back picture by picture. Opened at a tool call, it starts at that call's actions.
 */
export function BrowserLog(props: { runId: string; callId?: string; openedAt?: number }) {
  const rows = useLogRows(props.runId);
  const pictured = useMemo(() => (rows ?? []).filter((row) => row.picture), [rows]);
  const [chosen, setChosen] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);

  // Opened at a call: its first action is chosen, once the rows are read.
  const opened = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!rows || !props.callId || opened.current === props.openedAt) return;
    const first = rows.find((row) => row.callId === props.callId);
    if (!first) return;
    opened.current = props.openedAt;
    setPlaying(false);
    setChosen(first.seq);
  }, [rows, props.callId, props.openedAt]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setChosen((current) => {
        const next = pictured[pictured.findIndex((row) => row.seq === current) + 1];
        if (!next) {
          setPlaying(false);
          return current;
        }
        return next.seq;
      });
    }, PLAY_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [playing, pictured]);

  // The chosen action stays in view; with none chosen, the log follows the newest one as the
  // agent works.
  const newest = rows?.[rows.length - 1]?.seq ?? null;
  useEffect(() => {
    const seq = chosen ?? newest;
    if (seq === null) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-action="${seq}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [chosen, newest]);

  const shown = rows?.find((row) => row.seq === chosen) ?? rows?.[rows.length - 1];
  // The page after the chosen action, or after the last action before it that was pictured.
  const picture =
    shown?.picture ||
    [...pictured].reverse().find((row) => shown && row.seq <= shown.seq)?.picture ||
    "";
  const address = useLogPicture(props.runId, picture);
  const startedAt = rows?.[0]?.at ?? 0;

  const play = () => {
    if (playing) return setPlaying(false);
    const at = pictured.findIndex((row) => row.seq === chosen);
    if (at < 0 || at === pictured.length - 1) setChosen(pictured[0]?.seq ?? null);
    setPlaying(true);
  };

  if (rows && !rows.length) {
    return (
      <Text wrap size="meta" tone="muted" className="px-2.5 py-1.5">
        Each action the agent takes in its browser shows here, as it happens.
      </Text>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <Surface tone="well" radius="lg" className="aspect-[16/10] shrink-0 overflow-hidden">
        {address ? (
          <img
            src={address}
            alt={shown ? `The page after: ${actionSentence(shown)}` : ""}
            decoding="async"
            className="block size-full object-cover object-[top_left]"
          />
        ) : null}
      </Surface>
      <div className="flex min-w-0 shrink-0 items-center gap-1.5 pr-1">
        <IconButton
          label={playing ? "Pause" : "Play back"}
          disabled={pictured.length < 2}
          onClick={play}
        >
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        </IconButton>
        <OverflowFadeText className="flex-1">
          <Text bare size="meta" tone="default">
            {shown ? actionSentence(shown) : ""}
          </Text>
        </OverflowFadeText>
        {rows ? (
          <Figure>
            {shown ? rows.indexOf(shown) + 1 : 0} of {rows.length}
          </Figure>
        ) : null}
      </div>
      <ol
        ref={listRef}
        className="m-0 grid min-h-0 flex-1 list-none content-start overflow-y-auto p-0"
      >
        {(rows ?? []).map((row, index) => {
          const Icon = row.state === "failed" ? TriangleAlert : actionIcon(row);
          const selected = shown === row;
          // A tool call's actions sit together; the next call starts a little apart.
          const newCall = index > 0 && rows![index - 1]!.callId !== row.callId;
          const detail = [siteOf(row.url), verdictWords(row)].filter(Boolean).join(" · ");
          return (
            <Text
              as="li"
              bare
              size="meta"
              key={row.seq}
              data-action={row.seq}
              data-nested={row.nested || undefined}
              className={cn("data-[nested]:pl-3.5", newCall && "pt-1.5")}
            >
              <Pressable
                type="button"
                wash="control"
                selected={selected}
                aria-current={selected ? "step" : undefined}
                className={cn(rowShapeTwoLine, "w-full text-left")}
                onClick={() => {
                  setPlaying(false);
                  setChosen(row.seq);
                }}
              >
                <Text
                  bare
                  tone={row.state === "failed" ? "failed" : "muted"}
                  className="flex shrink-0"
                >
                  <Icon aria-hidden="true" />
                </Text>
                <span className="grid min-w-0 flex-1">
                  <OverflowFadeText>
                    {actionSentence(row)}
                    {row.state === "failed" ? (
                      <span className="sr-only">, which didn't work</span>
                    ) : null}
                  </OverflowFadeText>
                  {row.state === "failed" && row.error ? (
                    // Why it failed, whole: it's what the person reads the log for.
                    <Text bare wrap size="caption" tone="failed">
                      {row.error}
                    </Text>
                  ) : detail || row.note ? (
                    <OverflowFadeText>
                      <Text bare size="caption" tone="muted">
                        {[detail, row.note].filter(Boolean).join(" · ")}
                      </Text>
                    </OverflowFadeText>
                  ) : null}
                </span>
                <Figure>{offsetLabel(row.at, startedAt)}</Figure>
              </Pressable>
            </Text>
          );
        })}
      </ol>
    </div>
  );
}
