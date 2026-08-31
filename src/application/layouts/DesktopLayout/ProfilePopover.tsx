import { useAuth, useUserStore } from "@/features/auth";
import { reportSystemError } from "@/features/activity";
import { useSetupStore } from "@/features/installer";
import { Button } from "@/shared/ui";
import {
  Check,
  ChevronRight,
  ExternalLink,
  LogOut,
  Plus,
  Repeat2,
  UserCircle,
  X,
} from "lucide-react";
import type { CSSProperties, RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { emailName, initialsForProfile } from "./helpers";
import { adjacentPanelLeft, fitFloatingPanel } from "./popupGeometry";
import { accountChooserPopoverClass, profileMenuItemClass, profilePopoverClass } from "./styles";

const profilePopoverWidth = 286;
const profilePopoverFallbackHeight = 332;
const accountChooserWidth = 320;
const accountChooserFallbackHeight = 392;
const viewportGutter = 8;

export function ProfilePopover(props: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  currentPath: string;
  open: boolean;
  onClose: () => void;
  onOpenAccountSettings: () => void;
}) {
  const navigate = useNavigate();
  const currentUser = useSetupStore((state) => state.status?.current_user ?? null);
  const { user, accounts, transitioning, switchAccount, logout } = useAuth();
  const me = useUserStore(
    useShallow((state) => ({
      id: state.me?.id,
      email: state.me?.email,
      name: state.me?.name,
    })),
  );
  const menuRef = useRef<HTMLDivElement | null>(null);
  const accountChooserRef = useRef<HTMLDivElement | null>(null);
  const switchAccountsRef = useRef<HTMLButtonElement | null>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const [accountChooserStyle, setAccountChooserStyle] = useState<CSSProperties>({});
  const [accountChooserOpen, setAccountChooserOpen] = useState(false);
  const [switchingAccountId, setSwitchingAccountId] = useState("");
  const previouslyOpenRef = useRef(false);
  const account = user ?? currentUser;
  const accountMe = me.id === account?.id ? me : null;
  const email = accountMe?.email ?? account?.email ?? "";
  const displayName = accountMe?.name ?? account?.name ?? emailName(email) ?? "Misty";
  const initials = initialsForProfile(displayName, email);

  const updatePosition = useCallback(() => {
    const anchor = props.anchorRef.current;
    if (!anchor) return;
    const anchorRect = anchor.getBoundingClientRect();
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
      topInset: 28,
      gutter: viewportGutter,
    };
    const measuredMenu = menuRef.current?.getBoundingClientRect();
    const menuHeight = measuredMenu?.height || profilePopoverFallbackHeight;
    const menu = fitFloatingPanel(
      anchorRect.right + 10,
      anchorRect.bottom - menuHeight,
      profilePopoverWidth,
      menuHeight,
      viewport,
    );
    setMenuStyle((current) =>
      current.left === menu.left &&
      current.top === menu.top &&
      current.width === menu.width &&
      current.maxHeight === menu.maxHeight
        ? current
        : { left: menu.left, top: menu.top, width: menu.width, maxHeight: menu.maxHeight },
    );

    const measuredChooser = accountChooserRef.current?.getBoundingClientRect();
    const chooserHeight = measuredChooser?.height || accountChooserFallbackHeight;
    const fittedChooser = fitFloatingPanel(0, 0, accountChooserWidth, chooserHeight, viewport);
    const chooserLeft = adjacentPanelLeft({
      anchorLeft: menu.left,
      anchorWidth: menu.width,
      panelWidth: fittedChooser.width,
      viewportWidth: viewport.width,
      gutter: viewportGutter,
    });
    // Sit the chooser beside the Switch accounts row rather than anchoring it
    // to the profile button, so it opens right next to what was clicked.
    const rowRect = switchAccountsRef.current?.getBoundingClientRect();
    const rowOffset =
      rowRect && measuredMenu ? rowRect.top - measuredMenu.top : menu.height - chooserHeight;
    const chooser = fitFloatingPanel(
      chooserLeft,
      menu.top + rowOffset - 8,
      accountChooserWidth,
      chooserHeight,
      viewport,
    );
    setAccountChooserStyle((current) =>
      current.left === chooser.left &&
      current.top === chooser.top &&
      current.width === chooser.width &&
      current.maxHeight === chooser.maxHeight
        ? current
        : {
            left: chooser.left,
            top: chooser.top,
            width: chooser.width,
            maxHeight: chooser.maxHeight,
          },
    );
  }, [props.anchorRef]);

  useLayoutEffect(() => {
    if (!props.open) return;
    updatePosition();
  }, [accountChooserOpen, accounts.length, props.open, updatePosition]);

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
  }, [accountChooserOpen, props, updatePosition]);

  useEffect(() => {
    if (!props.open || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updatePosition);
    if (menuRef.current) observer.observe(menuRef.current);
    if (accountChooserRef.current) observer.observe(accountChooserRef.current);
    return () => observer.disconnect();
  }, [accountChooserOpen, props.open, updatePosition]);

  useEffect(() => {
    if (props.open) return;
    setAccountChooserOpen(false);
    setSwitchingAccountId("");
  }, [props.open]);

  useEffect(() => {
    if (props.open) {
      previouslyOpenRef.current = true;
      window.setTimeout(
        () => menuRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus(),
        0,
      );
      return;
    }
    if (previouslyOpenRef.current) props.anchorRef.current?.focus();
    previouslyOpenRef.current = false;
  }, [props.anchorRef, props.open]);

  if (!props.open) return null;

  const openAccountSettings = () => {
    props.onClose();
    props.onOpenAccountSettings();
  };

  const switchAccounts = () => {
    if (transitioning) return;
    setAccountChooserOpen(true);
  };

  const chooseAccount = async (accountId: string) => {
    if (accountId === account?.id || switchingAccountId || transitioning) return;
    setSwitchingAccountId(accountId);
    try {
      await switchAccount(accountId);
      props.onClose();
    } catch (error) {
      reportSystemError({
        accountId: account?.id,
        scope: "account:switch",
        title: "Account could not be switched",
        error,
        target: { kind: "route", href: props.currentPath },
      });
    } finally {
      setSwitchingAccountId("");
    }
  };

  const addAccount = () => {
    if (transitioning) return;
    props.onClose();
    navigate("/signin", { state: { from: props.currentPath, addingAccount: true } });
  };

  const signOut = () => {
    if (transitioning) return;
    props.onClose();
    void logout();
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
        <div className="grid grid-cols-[42px_minmax(0,1fr)] items-center gap-3 border-b border-charcoal-border px-2 pb-3 pt-1">
          <span
            className={[
              "relative grid h-10 w-10 place-items-center rounded-full",
              "bg-charcoal-active text-sm font-bold",
            ].join(" ")}
          >
            {account ? initials : <UserCircle size={24} strokeWidth={1.75} />}
          </span>
          <span className="min-w-0">
            <strong className="block truncate text-sm">{displayName}</strong>
            <small className="block truncate text-xs text-cream-muted">
              {email || "Not signed in"}
            </small>
          </span>
        </div>
        <div className="grid gap-1 py-2">
          <Button
            className={profileMenuItemClass}
            type="button"
            role="menuitem"
            onClick={openAccountSettings}
          >
            <UserCircle size={18} strokeWidth={2} />
            <span>Account settings</span>
            {/* This leaves the app for the browser, so say so rather than
                surprising people with a new window. */}
            <ExternalLink size={13} className="ml-auto text-cream-muted" aria-hidden="true" />
            <span className="sr-only">(opens in your browser)</span>
          </Button>
          <Button
            ref={switchAccountsRef}
            className={[
              profileMenuItemClass,
              accountChooserOpen ? "bg-charcoal-active text-cream" : "",
            ].join(" ")}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={accountChooserOpen}
            disabled={transitioning}
            onClick={() => (accountChooserOpen ? setAccountChooserOpen(false) : switchAccounts())}
          >
            <Repeat2 size={18} strokeWidth={2} />
            <span>Switch accounts</span>
            <ChevronRight
              size={14}
              className={accountChooserOpen ? "text-cream" : "text-cream-muted"}
            />
          </Button>
          <Button
            className={[
              profileMenuItemClass,
              "text-cream-bright hover:text-cream-bright",
              "hover:text-cream-bright",
            ].join(" ")}
            type="button"
            role="menuitem"
            disabled={transitioning}
            onClick={signOut}
          >
            <LogOut size={18} strokeWidth={2} />
            <span>Log out</span>
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
          <div className="flex items-center justify-between gap-3 border-b border-charcoal-border px-2 pb-2 pt-1">
            <div>
              <strong className="block text-sm">Switch accounts</strong>
              <small className="text-[11px] text-cream-muted">Your saved Misty sessions</small>
            </div>
            <Button
              className={[
                "grid size-8 place-items-center rounded-lg border-0 bg-transparent",
                "text-cream-muted hover:text-cream-bright",
              ].join(" ")}
              type="button"
              aria-label="Close account chooser"
              onClick={() => setAccountChooserOpen(false)}
            >
              <X size={16} />
            </Button>
          </div>
          <div className="grid max-h-[268px] gap-1 overflow-auto py-2">
            {accounts.map((saved) => {
              const active = saved.id === account?.id;
              const savedInitials = initialsForProfile(saved.name, saved.email);
              return (
                <Button
                  className={`${profileMenuItemClass} min-h-[54px] grid-cols-[36px_minmax(0,1fr)_20px]`}
                  type="button"
                  role="menuitem"
                  key={saved.id}
                  disabled={Boolean(switchingAccountId) || transitioning}
                  onClick={() => void chooseAccount(saved.id)}
                >
                  <span
                    className={[
                      "grid size-9 place-items-center rounded-full",
                      "bg-charcoal-active",
                      "text-xs font-bold text-cream",
                    ].join(" ")}
                  >
                    {savedInitials}
                  </span>
                  <span className="min-w-0">
                    <strong className="block truncate text-xs text-cream">{saved.name}</strong>
                    <small className="block truncate text-[10px] text-cream-muted">
                      {switchingAccountId === saved.id ? "Switching…" : saved.email}
                    </small>
                  </span>
                  {active ? (
                    <Check size={15} className="text-sage-fg" aria-label="Active account" />
                  ) : null}
                </Button>
              );
            })}
            {accounts.length === 0 ? (
              <p className="m-0 px-2 py-3 text-xs text-cream-muted">
                No saved accounts are available yet.
              </p>
            ) : null}
          </div>
          <Button
            className={profileMenuItemClass}
            type="button"
            role="menuitem"
            disabled={Boolean(switchingAccountId) || transitioning}
            onClick={addAccount}
          >
            <Plus size={18} strokeWidth={2} />
            <span>Add another account</span>
          </Button>
          <p className="m-0 px-2.5 pb-1 pt-2 text-[10px] leading-relaxed text-cream-muted">
            Accounts remain signed in securely on this device. Only one account is active in the app
            at a time.
          </p>
        </div>
      ) : null}
    </>,
    document.getElementById("misty-shell-overlays") ?? document.body,
  );
}
