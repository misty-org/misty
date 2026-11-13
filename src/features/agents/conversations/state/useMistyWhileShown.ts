import { useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceViewShown } from "@/features/app-windows";
import type { MistyState } from "./mistyState";
import { useMistyStore } from "./useMistyStore";

/**
 * A chat store read that holds still while its view is off screen. The store holds one open chat,
 * its draft and its streaming answer, so every mounted Agents tab rendered again for each tab
 * switch, keystroke and token. A hidden tab keeps what it last showed and catches up when it shows
 * again. The selector may return a fresh object: results are compared shallowly.
 */
export function useMistyWhileShown<T>(selector: (state: MistyState) => T): T {
  const shown = useWorkspaceViewShown();
  const held = useRef<{ value: T } | null>(null);
  const value = useMistyStore(
    useShallow((state: MistyState) =>
      !shown && held.current ? held.current.value : selector(state),
    ),
  );
  held.current = { value };
  return value;
}
