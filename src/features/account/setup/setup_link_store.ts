import { create } from "zustand";
import { openSignInSheet } from "../sign-in-sheet/sign_in_sheet_store";
import type { SetupLink } from "./server_address";

interface SetupLinkState {
  link: SetupLink | null;
  revision: number;
}

export const useSetupLinkStore = create<SetupLinkState>(() => ({ link: null, revision: 0 }));

export function openSetupLink(link: SetupLink): void {
  useSetupLinkStore.setState((state) => ({ link, revision: state.revision + 1 }));
  openSignInSheet("setup");
}

export function takeSetupLink(): SetupLink | null {
  const { link } = useSetupLinkStore.getState();
  if (link) useSetupLinkStore.setState({ link: null });
  return link;
}
