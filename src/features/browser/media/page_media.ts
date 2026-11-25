import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { hasTauriInternals } from "@/shared/platform/tauri";

export type PageMediaKind = "browser" | "app";

export interface PageMediaPage {
  kind: PageMediaKind;
  id: string;
}

export interface PageMedia {
  active: boolean;
  playing: boolean;
  title: string;
  artist: string;
  album: string;
  artwork: string;
  duration: number | null;
  position: number | null;
  canPrevious: boolean;
  canNext: boolean;
  canSeek: boolean;
}

export interface PlayingPage extends PageMediaPage {
  key: string;
  appId?: string;
  spaceId?: string;
  media: PageMedia;
  startedAt: number;
}

export type PageMediaAction = "play" | "pause" | "previoustrack" | "nexttrack" | "seekto";

interface PageMediaState {
  pages: Record<string, PlayingPage>;
  muted: Record<string, boolean>;
  closed: Record<string, boolean>;
}

export const pageMediaKey = (page: PageMediaPage) => `${page.kind}:${page.id}`;

export const usePageMedia = create<PageMediaState>(() => ({ pages: {}, muted: {}, closed: {} }));

const without = <T>(record: Record<string, T>, key: string): Record<string, T> => {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
};

interface PageMediaEvent {
  kind: PageMediaKind;
  id: string;
  appId?: string | null;
  spaceId?: string | null;
  media: PageMedia;
}

function heard(event: PageMediaEvent) {
  const key = pageMediaKey(event);
  usePageMedia.setState((state) => {
    if (!event.media.active)
      return { pages: without(state.pages, key), closed: without(state.closed, key) };
    const previous = state.pages[key];
    const started = event.media.playing && !previous?.media.playing;
    return {
      pages: {
        ...state.pages,
        [key]: {
          key,
          kind: event.kind,
          id: event.id,
          appId: event.appId ?? undefined,
          spaceId: event.spaceId ?? undefined,
          media: event.media,
          startedAt: started ? Date.now() : (previous?.startedAt ?? Date.now()),
        },
      },
      closed: event.media.playing ? without(state.closed, key) : state.closed,
    };
  });
}

let following = false;

export function followPageMedia() {
  if (following || !hasTauriInternals()) return;
  following = true;
  void listen<PageMediaEvent>("misty://page-media", ({ payload }) => heard(payload)).catch(() => {
    following = false;
  });
}

const pageOf = (page: PageMediaPage): PageMediaPage => ({ kind: page.kind, id: page.id });

export function actOnPageMedia(page: PageMediaPage, action: PageMediaAction, position?: number) {
  void invoke("page_media_act", {
    request: { page: pageOf(page), action, position: position ?? null },
  }).catch(() => undefined);
}

export function setPageMuted(page: PageMediaPage, muted: boolean) {
  const key = pageMediaKey(page);
  void invoke("page_media_set_muted", { request: { page: pageOf(page), muted } })
    .then(() =>
      usePageMedia.setState((state) => ({
        muted: muted ? { ...state.muted, [key]: true } : without(state.muted, key),
      })),
    )
    .catch(() => undefined);
}

export function closePageMedia(page: PageMediaPage) {
  const key = pageMediaKey(page);
  usePageMedia.setState((state) => ({ closed: { ...state.closed, [key]: true } }));
  actOnPageMedia(page, "pause");
}

export function forgetPageMedia(page: PageMediaPage) {
  const key = pageMediaKey(page);
  usePageMedia.setState((state) => ({
    pages: without(state.pages, key),
    muted: without(state.muted, key),
    closed: without(state.closed, key),
  }));
}
