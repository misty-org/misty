import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useUserStore } from "../../stores/useUserStore";
import { useSetupStore } from "../../stores/useSetupStore";

export function AccountMenu() {
  const currentUser = useSetupStore((state) => state.status?.current_user ?? null);
  const { user, logout } = useAuth();
  const me = useUserStore((state) => state.me);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const account = currentUser ?? user;
  const displayName = me?.name ?? account?.name ?? "";
  const initials = displayName
    ? displayName
        .split(" ")
        .map((word) => word[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : account?.email?.[0]?.toUpperCase() ?? "";

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function handleSignOut() {
    logout();
    setOpen(false);
  }

  function handleSignIn() {
    setOpen(false);
    navigate("/signin");
  }

  return (
    <div className="absolute right-6 top-4 z-40" ref={menuRef}>
      {account ? (
        <button
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="Account and settings"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-xs font-semibold text-black transition-colors hover:bg-zinc-200"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          {initials}
        </button>
      ) : (
        <button
          className="rounded-lg bg-white px-4 py-1.5 text-sm font-medium text-bg transition-colors duration-200 hover:bg-zinc-200"
          onClick={handleSignIn}
          type="button"
        >
          Sign In
        </button>
      )}

      {open && account && (
        <div className="absolute right-0 top-full pt-2" role="menu">
          <div className="glass-card w-44 overflow-hidden rounded-xl shadow-xl shadow-bg/50">
            <div className="border-b border-border/50 px-4 py-3">
              <p className="truncate text-sm font-medium text-text">{displayName}</p>
              <p className="truncate text-xs text-text-muted">{account.email}</p>
            </div>

            <Link
              className="block px-4 py-2.5 text-sm text-text-muted transition-colors hover:bg-elevated hover:text-text"
              onClick={() => {
                setOpen(false);
              }}
              role="menuitem"
              to="/account"
            >
              Account settings
            </Link>

            <button
              className="w-full border-t border-border/30 px-4 py-2.5 text-left text-sm text-text-muted transition-colors hover:bg-elevated hover:text-text"
              onClick={handleSignOut}
              role="menuitem"
              type="button"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
