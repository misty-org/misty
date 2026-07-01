import { officialAppPresentation } from "@/api/apps/appPresentation";
import { officialAppNeedsReview } from "./appInstallationStatus";
import { assertAppsClosedForUpdate } from "./appUpdateSafety";
import { useAppConsent } from "./useAppConsent";
import { useAppDownloads } from "./useAppDownloads";
import { hasTauriInternals } from "@/shared/platform/tauri";
import "./appDetails.css";
import { FaGithub } from "react-icons/fa6";
import { useNavigate } from "react-router-dom";
import { useAppsStore } from "./useAppsStore";
import type { OfficialApp, SpaceAppInstallation } from "@/api/apps";
import { OfficialAppIcon } from "./OfficialAppIcon";
import { appPermissionGroups, hasUnknownAppPermissions } from "./appPermissions";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui/dialog";
import {
  ArrowLeft,
  Clipboard,
  Database,
  Globe,
  Link,
  MonitorSmartphone,
  Sparkles,
  UsersRound,
  KeyRound,
  LoaderCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { discoverAppName, discoverAppPlatform, discoverAppSize } from "./appDetailsModel";

type Props = {
  app: OfficialApp | undefined;
  reviewPermissions?: boolean;
  consentAccountId?: string;
  onAgreed?: () => void;
  installation?: SpaceAppInstallation;
  actionAppId: string;
  mobile: boolean;
  error: string;
  onClose: () => void;
  onRestoreFocus: () => void;
  onInstall: (app: OfficialApp) => void | Promise<void>;
  onRemove: (app: OfficialApp) => void | Promise<void>;
};

export function OfficialAppDetails(props: Props) {
  const app = props.app && officialAppPresentation(props.app);
  return (
    <Dialog open={Boolean(app)} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent
        className="discover-details"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          props.onRestoreFocus();
        }}
      >
        {app && (
          <AppDetailsContent
            key={JSON.stringify([app.id, app.version, app.permission_version, app.scopes])}
            {...props}
            app={app}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function repositoryLink(value?: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password)
      return null;
    const parts = url.pathname.split("/").filter(Boolean);
    return parts.length >= 2 ? { href: url.href, label: parts.slice(0, 2).join("/") } : null;
  } catch {
    return null;
  }
}

const permissionIcons = {
  "Your Space": UsersRound,
  Webpages: Globe,
  Clipboard,
  "Links and tabs": Link,
  "App data": Database,
  "Misty AI": Sparkles,
};

function AppDetailsContent(props: Props & { app: OfficialApp }) {
  const { app, installation } = props;
  const storeAccountId = useAppsStore((state) => state.accountId);
  const accountId = props.consentAccountId ?? storeAccountId;
  const name = discoverAppName(app);
  const source = repositoryLink(app.repository_url);
  const installed = installation?.state === "installed";
  const needsReview = officialAppNeedsReview(app, installation);
  const unsupported = (props.mobile ? app.mobile : app.desktop).runtime === "unsupported";
  const unknown = hasUnknownAppPermissions(app.scopes);
  const groups = appPermissionGroups(app.scopes, installation?.granted_scopes);
  const [step, setStep] = useState<"details" | "permissions" | "remove">(
    props.reviewPermissions ? "permissions" : "details",
  );
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");
  const locked = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const busy = pending || Boolean(props.actionAppId);
  const error = failure || props.error;
  const navigate = useNavigate();
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  const run = async (action: () => Promise<void>) => {
    if (locked.current || busy) return;
    locked.current = true;
    setPending(true);
    setFailure("");
    try {
      await action();
      setStep("details");
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : "The app could not be changed. Try again.",
      );
    } finally {
      locked.current = false;
      setPending(false);
    }
  };
  const install = () =>
    run(async () => {
      if (!accountId || unknown || unsupported) return;
      assertAppsClosedForUpdate(app.id);
      if (hasTauriInternals() && app.desktop.runtime === "downloaded")
        await useAppDownloads.getState().get(app);
      if (useAppsStore.getState().accountId !== accountId)
        throw new Error("The account changed. Reopen the app to continue.");
      await props.onInstall(app);
      useAppConsent.getState().agree(accountId, app);
      if (props.reviewPermissions) props.onAgreed?.();
    });
  return (
    <>
      {step !== "details" && (
        <Button
          variant="ghost"
          className="discover-details-back"
          disabled={busy}
          aria-label="Back to details"
          onClick={() => setStep("details")}
        >
          <ArrowLeft size={18} aria-hidden="true" />
          Back to details
        </Button>
      )}
      {step === "details" ? (
        <>
          <div className="discover-details-heading">
            <OfficialAppIcon appId={app.id} size={64} />
            <div className="discover-details-identity">
              <DialogTitle ref={heading} tabIndex={-1} className="discover-app-name">
                {name}
              </DialogTitle>
              <dl className="discover-app-metadata">
                <div>
                  <dt>Author</dt>
                  <dd>{app.publisher}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>
                    {source ? (
                      <a href={source.href} target="_blank" rel="noopener noreferrer">
                        {source.label}
                        <FaGithub size={15} aria-hidden="true" />
                      </a>
                    ) : (
                      "Not provided"
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Version</dt>
                  <dd>{app.version}</dd>
                </div>
              </dl>
              <p className="discover-app-platform">
                <MonitorSmartphone size={16} aria-hidden="true" />
                <span>{discoverAppPlatform(app)}</span>
                <span aria-hidden="true">·</span>
                <span>{discoverAppSize(app, props.mobile)}</span>
              </p>
              <div className="discover-detail-primary-action">
                {installed && (
                  <Button
                    variant="secondary"
                    className="discover-action"
                    disabled={busy}
                    onClick={() => setStep("remove")}
                  >
                    Uninstall
                  </Button>
                )}
                {installed && !needsReview ? (
                  <Button
                    variant="default"
                    className="discover-action"
                    disabled={busy || unsupported}
                    onClick={() => {
                      props.onClose();
                      navigate(`/apps/${app.slug ?? app.id}`);
                    }}
                  >
                    Open
                  </Button>
                ) : (
                  <Button
                    variant="default"
                    className="discover-action"
                    disabled={busy || unsupported}
                    onClick={() => setStep("permissions")}
                  >
                    {installation?.consent_required
                      ? "Review permissions"
                      : installed
                        ? "Update"
                        : "Install"}
                  </Button>
                )}
              </div>
            </div>
          </div>
          <div className="discover-details-body misty-transient-scrollbar">
            <section className="discover-details-section" aria-label="About">
              <h3>About</h3>
              <DialogDescription className="discover-about-summary">
                {app.description}
              </DialogDescription>
              {app.about && <p className="discover-about-description">{app.about}</p>}
              <p className="discover-detail-note">
                Installed for your account. Choose which agents can use it in agent settings.
              </p>
              {installation?.consent_required && (
                <p className="discover-detail-note">
                  This app was previously enabled in a Space. Review its personal permissions to use
                  it.
                </p>
              )}
              {installation?.state === "recoverable" && (
                <p className="discover-detail-note">
                  Reinstall within 30 days to restore this app’s saved account data.
                </p>
              )}
              {unsupported && (
                <p className="discover-detail-note">This app isn’t available on this device.</p>
              )}
            </section>
          </div>
        </>
      ) : step === "remove" ? (
        <>
          <DialogTitle ref={heading} tabIndex={-1} className="discover-step-title">
            Uninstall {name}?
          </DialogTitle>
          <DialogDescription className="discover-permissions-intro">
            This revokes the app’s access across your account. Its saved account data can be
            restored for 30 days.
          </DialogDescription>
          <p className="discover-uninstall-copy">
            Shared Space content stays in your Spaces. Downloaded files and local app data on this
            device will be removed.
          </p>
          <footer className="discover-details-actions">
            <Button variant="secondary" className="discover-action" disabled={busy} onClick={() => setStep("details")}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="discover-action discover-uninstall"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await props.onRemove(app);
                  if (hasTauriInternals()) await useAppDownloads.getState().remove(app);
                })
              }
            >
              {pending ? "Uninstalling…" : "Uninstall"}
            </Button>
          </footer>
        </>
      ) : (
        <>
          <DialogTitle ref={heading} tabIndex={-1} className="discover-step-title">
            App permissions
          </DialogTitle>
          <DialogDescription className="discover-permissions-intro">
            Review what {name} can access for your account. {installed ? "Updating" : "Installing"}{" "}
            it does not grant access to shared Space content.
          </DialogDescription>
          <div className="discover-details-body misty-transient-scrollbar">
            {unknown && (
              <p className="discover-error" role="alert">
                Update Misty to review permissions this version cannot describe.
              </p>
            )}
            {!app.scopes.length && (
              <p className="discover-detail-note">No additional permissions requested.</p>
            )}
            <ul className="discover-permission-groups">
              {groups.map((group) => {
                const Icon =
                  permissionIcons[group.title as keyof typeof permissionIcons] ?? KeyRound;
                return (
                  <li key={group.title}>
                    <Icon size={21} aria-hidden="true" />
                    <div>
                      <h3>
                        {group.title}
                        {installed && group.added && (
                          <span className="discover-permission-new">New access</span>
                        )}
                      </h3>
                      {group.descriptions.map((description) => (
                        <p key={description}>{description}.</p>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
          <footer className="discover-details-actions">
            {pending && (
              <span role="status" className="discover-operation">
                <LoaderCircle size={15} className="animate-spin" />
                {installed ? "Updating…" : "Installing…"}
              </span>
            )}
            <Button variant="secondary" className="discover-action" disabled={busy} onClick={() => setStep("details")}>
              Cancel
            </Button>
            <Button
              variant="default"
              className="discover-action"
              disabled={busy || unknown || unsupported || !accountId}
              onClick={() => void install()}
            >
              {installed ? "Agree and update" : "Agree and install"}
            </Button>
          </footer>
        </>
      )}
      {error && (
        <p className="discover-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
