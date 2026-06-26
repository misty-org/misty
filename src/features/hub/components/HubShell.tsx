import { useEffect } from "react";
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { HubNavbar } from "./HubNavbar";

const titleByPath = new Map([
  ["/hub", "Misty Hub - Home"],
  ["/hub/dashboard", "Misty Hub - Dashboard"],
  ["/hub/resources/changelog", "Misty Hub - Changelog"],
  ["/hub/signin", "Misty Hub - Sign In"],
  ["/hub/register", "Misty Hub - Register"],
]);

export function HubShell({ children }: { children: ReactNode }) {
  const location = useLocation();

  useEffect(() => {
    const match = [...titleByPath.keys()]
      .sort((left, right) => right.length - left.length)
      .find((path) => location.pathname === path || location.pathname.startsWith(`${path}/`));
    const title = match ? titleByPath.get(match) : "Misty Hub";

    if (title) {
      document.title = title;
    }
    window.getSelection()?.removeAllRanges();
  }, [location.pathname]);

  const isAuthPage = location.pathname === "/hub/signin" || location.pathname === "/hub/register";

  return (
    <div className="hub-root min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.05),transparent_22%),linear-gradient(180deg,#07090b,#090c10_58%,#07090b)] text-text">
      {!isAuthPage ? <HubNavbar /> : null}
      <main
        className={
          isAuthPage
            ? "min-h-screen"
            : "min-h-screen pt-16 transition-[padding] duration-200 md:pt-0 md:pr-20"
        }
      >
        {children}
      </main>
    </div>
  );
}
