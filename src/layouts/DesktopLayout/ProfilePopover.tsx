import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Check, ChevronRight, LogOut, Plus, Repeat2, Settings as SettingsIcon, UserCircle, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/ui";
import { useAuth } from "@/features/auth/AuthContext";
import { useSetupStore } from "@/stores/app";
import { useUserStore } from "@/stores/account/useUserStore";
import { useSettingsStore } from "@/stores/app";
import {
  accountChooserPopoverClass,
  profileMenuItemClass,
  profilePopoverClass,
} from "./styles";
import { emailName, initialsForProfile } from "./helpers";

export function ProfilePopover(props: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  currentPath: string;
  open: boolean;
  onClose: () => void;
  onOpenAccountSettings: () => void;
  onOpenSettings: () => void;
}) {
  const navigate = useNavigate();
  const currentUser = useSetupStore((state) => state.status?.current_user ?? null);
  const { user, accounts, switchAccount, logout } = useAuth();
  const me = useUserStore(
    useShallow((state) => ({
      email: state.me?.email,
      name: state.me?.name,
    })),
  );
  const setActiveSettingsSection = useSettingsStore((state) => state.setActiveSection);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const accountChooserRef = useRef<HTMLDivElement | null>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const [accountChooserStyle, setAccountChooserStyle] = useState<CSSProperties>({});
  const [accountChooserOpen, setAccountChooserOpen] = useState(false);
  const [switchingAccountId, setSwitchingAccountId] = useState("");
  const [switchError, setSwitchError] = useState("");
  const account = currentUser ?? user;
  const email = me.email ?? account?.email ?? "";
  const displayName = me.name ?? account?.name ?? emailName(email) ?? "Misty";
  const initials = initialsForProfile(displayName, email);

  const updatePosition = useCallback(() => {
    const anchor = props.anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = 286;
    const estimatedHeight = 236;
    const left = Math.min(Math.max(8, rect.right + 10), window.innerWidth - width - 8);
    const top = Math.min(
      Math.max(8, rect.bottom - estimatedHeight),
      window.innerHeight - estimatedHeight - 8,
    );
    setMenuStyle((current) =>
      current.left === left && current.top === top && current.width === width
        ? current
        : { left, top, width },
    );
    const chooserWidth = 320;
    const chooserHeight = Math.min(420, window.innerHeight - 16);
    const chooserLeft = left + width + 8;
    const chooserTop = Math.min(
      Math.max(8, rect.bottom - chooserHeight),
      window.innerHeight - chooserHeight - 8,
    );
    setAccountChooserStyle((current) =>
      current.left === chooserLeft && current.top === chooserTop && current.width === chooserWidth
        ? current
        : { left: chooserLeft, top: chooserTop, width: chooserWidth },
    );
  }, [props.anchorRef]);

  useEffect(() => {
    if (!props.open) return;
    updatePosition();
    const closeOnPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (
        props.anchorRef.current?.contains(target) ||
        menuRef.current?.contains(target) ||
        accountChooserRef.current?.contains(target)
      )
        return;
      props.onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (accountChooserOpen) {
        setAccountChooserOpen(false);
        return;
      }
      props.onClose();
    };
    window.addEventListener("pointerdown", closeOnPointerDown, true);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown, true);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", updatePosition);
    };
  }, [accountChooserOpen, props.anchorRef, props.onClose, props.open, updatePosition]);

  useEffect(() => {
    if (props.open) return;
    setAccountChooserOpen(false);
    setSwitchingAccountId("");
    setSwitchError("");
  }, [props.open]);

  if (!props.open) return null;

  const openAccountSettings = () => {
    props.onClose();
    props.onOpenAccountSettings();
  };

  const switchAccounts = () => {
    setSwitchError("");
    setAccountChooserOpen(true);
  };

  const chooseAccount = async (accountId: string) => {
    if (accountId === user?.id || switchingAccountId) return;
    setSwitchError("");
    setSwitchingAccountId(accountId);
    try {
      await switchAccount(accountId);
      props.onClose();
    } catch (error) {
      setSwitchError(
        error instanceof Error ? error.message : "That account could not be activated.",
      );
    } finally {
      setSwitchingAccountId("");
    }
  };

  const addAccount = () => {
    props.onClose();
    navigate("/signin", { state: { from: props.currentPath, addingAccount: true } });
  };

  const signOut = () => {
    props.onClose();
    logout();
  };

  return createPortal(
    <>
      <div
        ref={menuRef}
        className={profilePopoverClass}
        style={menuStyle}
        role="menu"
        aria-label="Profile"
      >
        <div className="grid grid-cols-[42px_minmax(0,1fr)] items-center gap-3 border-b border-[var(--misty-border-soft)] px-2 pb-3 pt-1">
          <span className="relative grid h-10 w-10 place-items-center rounded-full bg-[var(--misty-neutral-selected-bg,var(--misty-surface-3))] text-sm font-bold">
            {account ? initials : <UserCircle size={24} strokeWidth={1.75} />}
          </span>
          <span className="min-w-0">
            <strong className="block truncate text-sm">{displayName}</strong>
            <small className="block truncate text-xs text-[var(--misty-text-muted)]">
              {email || "Not signed in"}
            </small>
          </span>
        </div>
        <div className="grid gap-1 py-2">
          <span className="px-2.5 py-1 text-[10px] font-bold capitalize text-[var(--misty-text-subtle)]">
            User/Profile Settings
          </span>
          <Button
            className={profileMenuItemClass}
            type="button"
            role="menuitem"
            onClick={openAccountSettings}
          >
            <UserCircle size={17} />
            <span>Account settings</span>
          </Button>
          <Button
            className={`${profileMenuItemClass} ${accountChooserOpen ? "bg-[var(--misty-neutral-selected-bg,var(--misty-surface-3))] text-[var(--misty-text)]" : ""}`}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={accountChooserOpen}
            onClick={() => (accountChooserOpen ? setAccountChooserOpen(false) : switchAccounts())}
          >
            <Repeat2 size={17} />
            <span>Switch accounts</span>
            <ChevronRight
              size={14}
              className={
                accountChooserOpen ? "text-[var(--misty-text)]" : "text-[var(--misty-text-subtle)]"
              }
            />
          </Button>
          <Button className={profileMenuItemClass} type="button" role="menuitem" onClick={signOut}>
            <LogOut size={17} />
            <span>{account ? "Sign out" : "Clear session"}</span>
          </Button>
          <div className="my-1 h-px bg-[var(--misty-border-soft)]" />
          <span className="px-2.5 py-1 text-[10px] font-bold capitalize text-[var(--misty-text-subtle)]">
            Misty App Settings
          </span>
          <Button
            className={profileMenuItemClass}
            type="button"
            role="menuitem"
            onClick={() => {
              setActiveSettingsSection("general");
              props.onClose();
              props.onOpenSettings();
            }}
          >
            <SettingsIcon size={17} />
            <span>Open app settings</span>
          </Button>
        </div>
      </div>
      {accountChooserOpen ? (
        <div
          ref={accountChooserRef}
          className={accountChooserPopoverClass}
          style={accountChooserStyle}
          role="menu"
          aria-label="Switch accounts"
        >
          <div className="flex items-center justify-between gap-3 border-b border-[var(--misty-border-soft)] px-2 pb-2 pt-1">
            <div>
              <strong className="block text-sm">Switch accounts</strong>
              <small className="text-[11px] text-[var(--misty-text-subtle)]">
                Your saved Misty sessions
              </small>
            </div>
            <Button
              className="grid size-8 place-items-center rounded-lg border-0 bg-transparent text-[var(--misty-text-muted)] hover:bg-[var(--misty-surface-2)] hover:text-[var(--misty-text)]"
              type="button"
              aria-label="Close account chooser"
              onClick={() => setAccountChooserOpen(false)}
            >
              <X size={16} />
            </Button>
          </div>
          <div className="grid max-h-[268px] gap-1 overflow-auto py-2">
            {accounts.map((saved) => {
              const active = saved.id === user?.id;
              const savedInitials = initialsForProfile(saved.name, saved.email);
              return (
                <Button
                  className={`${profileMenuItemClass} min-h-[54px] grid-cols-[36px_minmax(0,1fr)_20px]`}
                  type="button"
                  role="menuitem"
                  key={saved.id}
                  disabled={Boolean(switchingAccountId)}
                  onClick={() => void chooseAccount(saved.id)}
                >
                  <span className="grid size-9 place-items-center rounded-full bg-[var(--misty-neutral-selected-bg,var(--misty-surface-3))] text-xs font-bold text-[var(--misty-text)]">
                    {savedInitials}
                  </span>
                  <span className="min-w-0">
                    <strong className="block truncate text-xs text-[var(--misty-text)]">
                      {saved.name}
                    </strong>
                    <small className="block truncate text-[10px] text-[var(--misty-text-subtle)]">
                      {switchingAccountId === saved.id ? "Switching…" : saved.email}
                    </small>
                  </span>
                  {active ? (
                    <Check size={15} className="text-emerald-300" aria-label="Active account" />
                  ) : null}
                </Button>
              );
            })}
            {accounts.length === 0 ? (
              <p className="m-0 px-2 py-3 text-xs text-[var(--misty-text-subtle)]">
                No saved accounts are available yet.
              </p>
            ) : null}
          </div>
          {switchError ? (
            <p
              className="m-0 mb-2 rounded-lg border border-red-400/20 bg-red-950/20 px-2.5 py-2 text-[11px] leading-relaxed text-red-200"
              role="alert"
            >
              {switchError}
            </p>
          ) : null}
          <Button
            className={profileMenuItemClass}
            type="button"
            role="menuitem"
            disabled={Boolean(switchingAccountId)}
            onClick={addAccount}
          >
            <Plus size={17} />
            <span>Add another account</span>
          </Button>
          <p className="m-0 px-2.5 pb-1 pt-2 text-[10px] leading-relaxed text-[var(--misty-text-subtle)]">
            Accounts remain signed in securely on this device. Only one account is active in the app
            at a time.
          </p>
        </div>
      ) : null}
    </>,
    document.body,
  );
}
