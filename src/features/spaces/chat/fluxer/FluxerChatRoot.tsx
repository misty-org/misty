// SPDX-License-Identifier: AGPL-3.0-or-later
// Space chat's root, as Fluxer's app root is set up (https://github.com/fluxerapp/fluxer):
// its tokens (in Misty's colors, misty-colors.css), and html.window-focused while the window has focus (inline_scripts/theme.js, WindowFocusInteraction
// Guard.ts), which its hover rules wait on.
import { useEffect, type ComponentProps } from "react";
import "./tokens.css";
import "./misty-colors.css";
import "./base.css";
import { cx } from "./cx";

/** Keeps html.window-focused in step with the window's focus while any chat is open. */
function useWindowFocusedClass() {
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => root.classList.toggle("window-focused", document.hasFocus());
    sync();
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);
    return () => {
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", sync);
      root.classList.remove("window-focused");
    };
  }, []);
}

export function FluxerChatRoot({ className, ...props }: ComponentProps<"div">) {
  useWindowFocusedClass();
  return <div className={cx("fluxer-chat", className)} {...props} />;
}
