import { create } from "zustand";
import { openSignInSheet } from "../signInSheet/signInSheetStore";
import type { SetupLink } from "./serverAddress";

/**
 * A setup link the app was opened with (`misty://setup?server=…&key=…`), waiting for the Misty
 * Cloud screen to fill itself in. Held in memory only, and never logged: the key signs in.
 */
interface SetupLinkState {
  link: SetupLink | null;
  /** Counts links, so a second link replaces the first on a screen that is already open. */
  revision: number;
}

export const useSetupLinkStore = create<SetupLinkState>(() => ({ link: null, revision: 0 }));

/** Opens the setup wizard on Misty Cloud with the link's server and key filled in. */
export function openSetupLink(link: SetupLink): void {
  useSetupLinkStore.setState((state) => ({ link, revision: state.revision + 1 }));
  openSignInSheet("setup");
}

/** Takes the waiting link, so it fills one screen once. */
export function takeSetupLink(): SetupLink | null {
  const { link } = useSetupLinkStore.getState();
  if (link) useSetupLinkStore.setState({ link: null });
  return link;
}
