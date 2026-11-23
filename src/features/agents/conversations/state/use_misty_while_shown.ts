import { useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceViewShown } from "@/features/app-windows";
import type { MistyState } from "./misty_state";
import { useMistyStore } from "./use_misty_store";

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
