import {
  providerNavigationTitles,
  providerUnreadCount,
} from "./navigationTitles";
import type { ReactNode } from "react";
import { useCallback } from "react";
import { RotateCw } from "lucide-react";
import { BrowserMenuView } from "@/features/browser/BrowserMenuView";
import { PagePinButton } from "./PagePinButton";
import { mistyBrowserProviders, type MistyAppSDK } from "@misty/sdk";
import { savedWebsiteUrl } from "./websiteIntegrations";
import "./websiteChrome.css";

type View = Awaited<ReturnType<MistyAppSDK["browser"]["create"]>>;
export function WebsiteHeader(props: {
  active?: boolean;
  route: string;
  misty: MistyAppSDK;
  view: View | null;
  label: string;
  providerId?: keyof typeof mistyBrowserProviders;
  icon: ReactNode;
  url: string;
  title?: string;
  accountLabel?: string;
  loading?: boolean;
  onPin(): void;
  pinned: boolean;
  canPin?: boolean;
  pinBusy?: boolean;
  canOpenExternal?: boolean;
  report(error: unknown): void;
}) {
  const { misty, view, report } = props;
  const servicePage = props.providerId
    ? savedWebsiteUrl(props.providerId, props.url)
    : undefined;
  const away =
    !!props.providerId &&
    !!props.url &&
    props.url !== "about:blank" &&
    !servicePage;
  const overlay = useCallback(
    async (reason: string, active: boolean) => {
      if (view) await misty.browser.overlay(view.handle, reason, active);
    },
    [misty, view],
  );
  let address = props.label;
  try {
    address = new URL(props.url).hostname;
  } catch {
    /* The profile is opening. */
  }
  const unread = !away
    ? providerUnreadCount(props.title ?? "", props.label)
    : undefined;
  return (
    <header
      className="website-header browser-toolbar"
      aria-label={`${props.label} website navigation`}
    >
      <button
        className="website-icon-button"
        aria-label="Refresh"
        title="Refresh"
        disabled={!view}
        onClick={() => {
          if (view) void misty.browser.reload(view.handle).catch(report);
        }}
      >
        <RotateCw
          size={16}
          className={props.loading ? "website-refreshing" : undefined}
        />
      </button>
      <div
        className="website-address"
        title={away ? address : props.url || props.label}
      >
        <span className="website-address-icon" aria-hidden="true">
          {props.icon}
        </span>
        <span className="website-address-title">
          {
            providerNavigationTitles({
              platform: props.label,
              title: props.title ?? "",
              url: props.url,
              inPlatform: !away,
              accountLabel: props.accountLabel,
            }).header
          }
        </span>
        {unread && (
          <span
            className="website-address-count"
            aria-label={`${unread} unread`}
          >
            ({unread})
          </span>
        )}
      </div>
      <PagePinButton
        pinned={props.pinned}
        busy={props.pinBusy}
        disabled={!props.canPin}
        onClick={props.onPin}
      />
      <BrowserMenuView
        iconButtonClass="website-icon-button"
        label="More website actions"
        overlayReason="website-actions"
        active={props.active}
        url={props.url}
        canOpenExternal={props.canOpenExternal ?? false}
        zoomId={view?.handle}
        setZoom={async (factor) => {
          if (view) await misty.browser.setZoom(view.handle, factor);
        }}
        setOverlay={overlay}
        openExternal={(url) => misty.links.openExternal(url)}
        reportError={report}
      />
    </header>
  );
}
