import { passwordsApi } from "@/features/passwords/api";
import { PASSWORD_MENU_CLICK_DELAY_MS, usePasswordMenuStore } from "@/features/passwords/fillMenu";
import { Button, cn, Portal } from "@/shared/ui";
import { setBrowserError } from "./browserErrors";

const MENU_MIN_WIDTH = 220;

function pageHost(tabId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-browser-workspace-tab="${CSS.escape(tabId)}"] [data-browser-page-host]`,
  );
}

/**
 * Saved sign-ins for the focused field. Misty draws this, not the page: anything in a page's own
 * document can be read and clicked by its scripts. A notice rather than a menu, so the page keeps
 * the keyboard and someone can type a different sign-in instead.
 */
export function PasswordFillMenu(props: { tabId: string; runtimeId: string; active: boolean }) {
  const menu = usePasswordMenuStore((state) => state.menus[props.runtimeId]);
  const host = props.active && menu ? pageHost(props.tabId) : null;
  if (!menu || !host) return null;
  const page = host.getBoundingClientRect();
  const width = Math.min(Math.max(menu.place.width * page.width, MENU_MIN_WIDTH), page.width);
  const left = page.left + Math.min(menu.place.left * page.width, page.width - width);
  const top = page.top + menu.place.bottom * page.height + 4;
  const { hold, close } = usePasswordMenuStore.getState();
  const fill = (login: string) => {
    if (performance.now() - menu.shownAt < PASSWORD_MENU_CLICK_DELAY_MS) return;
    hold(null);
    close(menu.id);
    void passwordsApi
      .fillPage(menu.id, login)
      .catch((error: unknown) => setBrowserError(props.tabId, error));
  };
  return (
    <Portal>
      <div
        role="listbox"
        aria-label="Saved sign-ins"
        data-misty-notification="true"
        data-misty-window-drag-block="true"
        className={cn(
          "fixed layer-notification flex max-h-64 flex-col gap-0.5 overflow-y-auto",
          "rounded-lg border border-charcoal-border bg-charcoal-card p-1 text-cream",
        )}
        style={{ left, top, width }}
        onPointerEnter={() => hold(menu.id)}
        onPointerLeave={() => hold(null)}
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
      </div>
    </Portal>
  );
}
