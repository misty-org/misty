import {
  createPageFieldMenuStore,
  listenForPageFieldMenu,
  type PageFieldMenu,
} from "@/features/webviews/pageFieldMenu";

export interface PasswordMenu extends PageFieldMenu {
  origin: string;
  logins: { id: string; username: string }[];
}

/** Saved sign-ins offered for a focused field, by page. */
export const usePasswordMenuStore = createPageFieldMenuStore<PasswordMenu>();

/** An empty list closes the menu. */
export function listenForPasswordMenus(): () => void {
  return listenForPageFieldMenu(
    "misty://browser-password-menu",
    usePasswordMenuStore,
    (payload) => payload.logins.length === 0,
  );
}
