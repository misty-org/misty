import "./appDetails.css";
import type { OfficialApp, UserAppInstallation } from "@/api/apps";
import { OfficialAppIcon } from "./OfficialAppIcon";
import { officialAppNeedsConsent, officialAppNeedsReview } from "./appInstallationStatus";
import { appPermissionGroups, hasUnknownAppPermissions } from "./appPermissions";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui/dialog";
import {
  ArrowLeft,
  ArrowUpRight,
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
  installation?: UserAppInstallation;
  actionAppId: string;
  mobile: boolean;
  error: string;
  onClose: () => void;
  onRestoreFocus: () => void;
  onInstall: (app: OfficialApp) => void | Promise<void>;
  onRemove: (app: OfficialApp) => void | Promise<void>;
};

export function OfficialAppDetails(props: Props) {
  const app = props.app;
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
  const [step, setStep] = useState<"details" | "permissions" | "uninstall">("details");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");
  const locked = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const busy = pending || Boolean(props.actionAppId);
  const installed = installation?.state === "installed";
  const update = officialAppNeedsReview(app, installation);
  const unsupported = (props.mobile ? app.mobile : app.desktop).runtime === "unsupported";
  const unknown = hasUnknownAppPermissions(app.scopes);
  const groups = appPermissionGroups(app.scopes, installation?.granted_scopes);
  const source = repositoryLink(app.repository_url);
  const name = discoverAppName(app);
  const error = failure || props.error;
  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  const run = async (operation: "install" | "uninstall") => {
    if (locked.current || busy || (operation === "install" && (unknown || unsupported))) return;
    locked.current = true;
    setPending(true);
    setFailure("");
    try {
      await (operation === "install" ? props.onInstall(app) : props.onRemove(app));
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

  return (
    <>
      {step !== "details" && (
        <button
          type="button"
          className="discover-details-back"
          disabled={busy}
          aria-label={`Back to ${name} details`}
          onClick={() => {
            setFailure("");
            setStep("details");
          }}
        >
          <ArrowLeft size={17} aria-hidden="true" />
          {name}
        </button>
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
                        <ArrowUpRight size={13} aria-hidden="true" />
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
            </div>
          </div>
          <div className="discover-details-body misty-transient-scrollbar">
            <section className="discover-details-section" aria-label="About">
              <h3>About</h3>
              <DialogDescription className="discover-about-summary">
                {app.description}
              </DialogDescription>
              {app.about && <p className="discover-about-description">{app.about}</p>}
              {!props.mobile && app.requires_apps?.includes("browser") && (
                <p className="discover-detail-note">
                  Website accounts on Mac also require Browser.
                </p>
              )}
              {installation?.state === "recoverable" && (
                <p className="discover-detail-note">
                  Installing this app restores its recoverable saved data.
                </p>
              )}
              {installed && (
                <p className="discover-detail-note">
                  {update ? `Version ${app.version} is available to install.` : "Installed"}
                </p>
              )}
              {unsupported && (
                <p className="discover-detail-note">This app isn’t available on this device.</p>
              )}
              {error && (
                <p className="discover-error" role="alert">
                  {error}
                </p>
              )}
            </section>
          </div>
        </>
      ) : step === "permissions" ? (
        <>
          <DialogTitle ref={heading} tabIndex={-1} className="discover-step-title">
            App permissions
          </DialogTitle>
          <DialogDescription className="discover-permissions-intro">
            {name} needs access to the following:
          </DialogDescription>
          <div className="discover-details-body misty-transient-scrollbar">
            {unknown && (
              <p className="discover-error" role="alert">
                This app requests access that this version of Misty cannot describe. Update Misty
                before installing it.
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
            {error && (
              <p className="discover-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </>
      ) : (
        <>
          <DialogTitle ref={heading} tabIndex={-1} className="discover-step-title">
            Uninstall {name}?
          </DialogTitle>
          <div className="discover-details-body misty-transient-scrollbar">
            <DialogDescription className="discover-uninstall-copy">
              The app will be uninstalled from your signed-in devices. Your private app data can be
              recovered for 30 days, then it will be permanently deleted. Content shared with a
              Space will remain in that Space.
            </DialogDescription>
            {error && (
              <p className="discover-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </>
      )}
      <footer className="discover-details-actions">
        {pending && (
          <span className="discover-operation" role="status">
            <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />
            {step === "uninstall" ? "Uninstalling…" : "Installing…"}
          </span>
        )}
        {step === "permissions" ? (
          <>
            <p className="discover-consent-copy">Agree to these permissions to install {name}.</p>
            <button
              type="button"
              className="discover-action discover-action-primary"
              disabled={busy || unknown || unsupported}
              onClick={() => void run("install")}
            >
              Agree
            </button>
          </>
        ) : step === "uninstall" ? (
          <button
            type="button"
            className="discover-action discover-uninstall"
            disabled={busy}
            onClick={() => void run("uninstall")}
          >
            Uninstall
          </button>
        ) : (
          <>
            {installed && (
              <button
                type="button"
                className="discover-action"
                disabled={busy}
                onClick={() => setStep("uninstall")}
              >
                Uninstall
              </button>
            )}
            {(!installed || update) && (
              <button
                type="button"
                className="discover-action discover-action-primary"
                disabled={busy || unsupported}
                onClick={() => {
                  setFailure("");
                  if (unknown || officialAppNeedsConsent(app, installation)) setStep("permissions");
                  else void run("install");
                }}
              >
                Install
              </button>
            )}
          </>
        )}
      </footer>
    </>
  );
}
