import { FolderOpen, LogIn } from "lucide-react";
import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import mistyArtwork from "../../../assets/misty-main.png";
import { trackOnboardingCompleted } from "../../../analytics/lifecycle";

const welcomeStorageKey = "misty.mobile.welcome.v1";

export function MobileFirstLaunchWelcome() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(() => !hasSeenWelcome());

  const completeWelcome = useCallback(() => {
    try {
      window.localStorage.setItem(welcomeStorageKey, "1");
    } catch {
      // The welcome state can remain session-only when storage is unavailable.
    }
    setOpen(false);
    void trackOnboardingCompleted();
  }, []);

  if (!open) return null;

  return (
    <section
      className="absolute inset-0 z-[2000] grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] overflow-auto bg-[var(--misty-bg)] bg-[image:var(--misty-grid-bg)] bg-[length:var(--misty-grid-size)] px-[max(24px,var(--misty-safe-right))] pb-5 pl-[max(24px,var(--misty-safe-left))] pr-[max(24px,var(--misty-safe-right))] pt-[calc(34px+var(--misty-safe-top))] text-[var(--misty-text)]"
      aria-label="Welcome to Misty"
    >
      <div className="grid content-center justify-items-center gap-5 text-center">
        <img
          className="h-[132px] w-[132px] object-contain"
          src={mistyArtwork}
          alt=""
          aria-hidden="true"
        />
        <div className="grid max-w-[320px] gap-3">
          <span className="text-[11px] font-bold uppercase text-[var(--misty-text-subtle)]">Welcome</span>
          <h1 className="m-0 text-[38px] font-black leading-none text-[var(--misty-text)]">Misty</h1>
          <p className="m-0 text-[17px] leading-relaxed text-[var(--misty-text-muted)]">
            Your files, close at hand on this device and across your connected remotes.
          </p>
        </div>
      </div>

      <div className="grid gap-2.5 pt-7">
        <button
          type="button"
          className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[var(--misty-radius-sm)] border border-[var(--misty-primary)] bg-[var(--misty-primary)] px-4 text-base font-bold text-[var(--misty-primary-contrast)]"
          onClick={completeWelcome}
        >
          <FolderOpen size={19} /> Browse this device
        </button>
        <button
          type="button"
          className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[var(--misty-radius-sm)] border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-4 text-base font-bold text-[var(--misty-text)]"
          onClick={() => {
            completeWelcome();
            navigate("/account/signin");
          }}
        >
          <LogIn size={19} /> Sign in to Misty
        </button>
      </div>
    </section>
  );
}

function hasSeenWelcome(): boolean {
  try {
    return window.localStorage.getItem(welcomeStorageKey) === "1";
  } catch {
    return false;
  }
}

export default MobileFirstLaunchWelcome;
