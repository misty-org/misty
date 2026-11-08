import { passwordsApi } from "../passwords/api";
import { usePasswordMenuStore } from "../passwords/fillMenu";
import { fieldMenuTakesClicks } from "../webviews/pageFieldMenu";
import { Button } from "@/shared/ui";
import { setBrowserError } from "./browserErrors";
import { PageFieldNotice } from "./PageFieldNotice";

/** Saved sign-ins for the focused field, in Misty's interface and never in the page. */
export function PasswordFillMenu(props: { tabId: string; runtimeId: string; active: boolean }) {
  const menu = usePasswordMenuStore((state) => state.menus[props.runtimeId]);
  if (!menu || !props.active) return null;
  const fill = (login: string) => {
    if (!fieldMenuTakesClicks(menu)) return;
    const { hold, close } = usePasswordMenuStore.getState();
    hold(null);
    close(menu.id);
    void passwordsApi
      .fillPage(menu.id, login)
      .catch((error: unknown) => setBrowserError(props.tabId, error));
  };
  return (
    <PageFieldNotice
      tabId={props.tabId}
      menu={menu}
      store={usePasswordMenuStore}
      label="Saved sign-ins"
      minWidth={220}
    >
      {menu.logins.map((login) => (
        <Button
          key={login.id}
          role="option"
          aria-selected={false}
          variant="ghost"
          size="xs"
          className="w-full justify-start truncate"
          onClick={() => fill(login.id)}
        >
          {login.username || "Saved password"}
        </Button>
      ))}
    </PageFieldNotice>
  );
}
