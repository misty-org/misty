import { useEffect, useState, type RefObject } from "react";
import type { AvatarTone as ItemTone } from "@misty/ui";
import type { AgentAtWork } from "./notebookAgents";
import { liveNotebook, useLiveNotebook } from "./notebookLive";
import { personColor, personTone } from "./personTone";

/**
 * Who else is in a notebook and what they're doing, from its room's awareness: which pane they're
 * in, what they have open, the note they're typing in, whether their AI is answering them, and
 * their pointer. None of it is stored, and nothing about what anyone asks their AI goes out.
 */

/** The panes: sources, the middle (the person's own chat, or a source or note open to read) and
 * Create. */
export type NotebookPane = "sources" | "chat" | "reader" | "studio";

export interface LabPresence {
  section?: NotebookPane;
  /** The source or note open in the middle. */
  item?: string;
  /** The note they're typing in. */
  editing?: string;
  /** Their AI is answering them now. */
  asking?: boolean;
  /**
   * Their pointer, anchored to what's under it rather than to the window, since windows differ:
   * the pane, the row's anchor and where in it, as fractions.
   */
  pointer?: { pane: NotebookPane; anchor?: string; x: number; y: number } | null;
  /** This person's agents at work in the notebook (notebookAgents.ts). */
  agents?: AgentAtWork[];
}

export interface Person {
  clientId: number;
  id: string;
  name: string;
  tone: ItemTone;
  color: string;
  lab: LabPresence;
}

/** Says what this person is doing in the notebook, for the others in it. */
export function setPresence(notebookId: string, change: Partial<LabPresence>) {
  const entry = liveNotebook(notebookId);
  if (!entry) return;
  const awareness = entry.live.awareness;
  const current = (awareness.getLocalState()?.lab ?? {}) as LabPresence;
  const next = { ...current, ...change };
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  awareness.setLocalStateField("lab", next);
}

/** The others in the notebook now: one entry a person, however many windows they have open. */
export function usePeople(notebookId: string): Person[] {
  const entry = useLiveNotebook(notebookId);
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => {
    if (!entry) return setPeople([]);
    const awareness = entry.live.awareness;
    const read = () => {
      const byPerson = new Map<string, Person>();
      awareness.getStates().forEach((state, clientId) => {
        const user = state.user as { id?: string; name?: string } | undefined;
        if (clientId === awareness.clientID || !user?.id || user.id === entry.me) return;
        const lab = (state.lab ?? {}) as LabPresence;
        const known = byPerson.get(user.id);
        // Of two windows, the one with a pointer or a pane is the one they're using.
        if (known && (known.lab.pointer || known.lab.section) && !lab.pointer) return;
        byPerson.set(user.id, {
          clientId,
          id: user.id,
          name: user.name || "Someone",
          tone: personTone(user.id),
          color: personColor(user.id),
          lab,
        });
      });
      setPeople([...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name)));
    };
    read();
    awareness.on("change", read);
    return () => awareness.off("change", read);
  }, [entry]);
  return people;
}

/** Where a pointer is in its pane: over an anchored row, or the pane itself. */
export function anchorPoint(
  target: Element | null,
  clientX: number,
  clientY: number,
): LabPresence["pointer"] {
  const pane = target?.closest<HTMLElement>("[data-live-pane]");
  if (!pane) return null;
  const anchored = target?.closest<HTMLElement>("[data-live-anchor]");
  const box = (anchored && pane.contains(anchored) ? anchored : pane).getBoundingClientRect();
  if (!box.width || !box.height) return null;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    pane: pane.dataset.livePane as NotebookPane,
    anchor: anchored && pane.contains(anchored) ? anchored.dataset.liveAnchor : undefined,
    x: round((clientX - box.left) / box.width),
    y: round((clientY - box.top) / box.height),
  };
}

/**
 * Publishes this person's pane and pointer while they move over the notebook, about 30 times a
 * second at most, and clears the pointer when it leaves.
 */
export function usePublishPointer(notebookId: string, frame: RefObject<HTMLElement | null>) {
  const entry = useLiveNotebook(notebookId);
  useEffect(() => {
    const element = frame.current;
    if (!element || !entry) return;
    let last = 0;
    let queued: number | undefined;
    let latest: PointerEvent | undefined;
    const send = () => {
      queued = undefined;
      last = Date.now();
      if (!latest) return;
      const pointer = anchorPoint(latest.target as Element, latest.clientX, latest.clientY);
      setPresence(notebookId, { pointer, ...(pointer ? { section: pointer.pane } : {}) });
    };
    const move = (event: PointerEvent) => {
      latest = event;
      if (queued) return;
      queued = window.setTimeout(send, Math.max(0, 33 - (Date.now() - last)));
    };
    const leave = () => {
      latest = undefined;
      if (queued) window.clearTimeout(queued);
      queued = undefined;
      setPresence(notebookId, { pointer: null });
    };
    const focus = (event: FocusEvent) => {
      const pane = (event.target as Element | null)?.closest<HTMLElement>("[data-live-pane]");
      if (pane) setPresence(notebookId, { section: pane.dataset.livePane as NotebookPane });
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerleave", leave);
    element.addEventListener("focusin", focus);
    return () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerleave", leave);
      element.removeEventListener("focusin", focus);
      if (queued) window.clearTimeout(queued);
    };
  }, [notebookId, frame, entry]);
}
