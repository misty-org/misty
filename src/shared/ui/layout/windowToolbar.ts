/**
 * For a toolbar the native window buttons can sit over (one marked `data-window-toolbar`): while
 * the shell finds the buttons over it, it marks it `data-window-chrome="true"`, and each end keeps
 * its own padding or the buttons' room, whichever is more. The shell writes both, the toolbar's own
 * padding (`--window-toolbar-base-left/right`) and the room (`--window-chrome-left/right`).
 *
 * ```tsx
 * <header data-window-toolbar className={cn(windowToolbarClass, "flex h-10 px-3")}>…</header>
 * ```
 */
export const windowToolbarClass =
  "data-[window-chrome=true]:!pl-[max(var(--window-toolbar-base-left,8px),var(--window-chrome-left,0px))] " +
  "data-[window-chrome=true]:!pr-[max(var(--window-toolbar-base-right,8px),var(--window-chrome-right,0px))]";
