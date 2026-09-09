import { officialAppNeedsReview } from "./appInstallationStatus";
import { assertAppsClosedForUpdate } from "./appUpdateSafety";
import { appConsentKey, useAppConsent } from "./useAppConsent";
import { appDownloadKey, useAppDownloads } from "./useAppDownloads";
import { hasTauriInternals } from "@/shared/platform/tauri";
import "./appDetails.css";
import { FaGithub } from "react-icons/fa6";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { AppSpaceAccessPanel, type SpaceAccessChange } from "./AppSpaceAccessPanel";
import { useAppsStore } from "./useAppsStore";
import { useSpacesStore } from "@/features/spaces/core";
import type { OfficialApp, SpaceAppInstallation } from "@/api/apps";
import { OfficialAppIcon } from "./OfficialAppIcon";
import { appPermissionGroups, hasUnknownAppPermissions } from "./appPermissions";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui/dialog";
import {
  ArrowLeft,
  ChevronDown,
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
  const spaceId = useAppsStore((state) => state.spaceId);
  const spaces = useSpacesStore((state) => state.spaces);
  const storeAccountId = useAppsStore((state) => state.accountId);
  const accountId = props.consentAccountId ?? storeAccountId;
  const agreed = useAppConsent((state) =>
    Boolean(accountId && state.agreed[appConsentKey(accountId, app)]),
  );
  const prefetchSpaceAccess = useAppsStore((state) => state.prefetchSpaceAccess);
  useEffect(() => {
    void prefetchSpaceAccess();
  }, [accountId, spaces, prefetchSpaceAccess]);
  const downloadedState = useAppDownloads((state) => state.ready[appDownloadKey(app)]);
  const checkDownloads = useAppDownloads((state) => state.check);
  useEffect(() => {
    void checkDownloads([app]);
  }, [app, checkDownloads]);
  const removed = useAppDownloads((state) => state.removed[app.id]);
  const downloaded =
    !removed &&
    (hasTauriInternals() ? downloadedState === true : installation?.state === "installed");
  const [permissionPurpose, setPermissionPurpose] = useState<"download" | "spaces" | "update">(
    "spaces",
  );
  const [targets, setTargets] = useState<SpaceAccessChange[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const targetAccount = useRef("");
  const spaceName = (
    targets.length
      ? targets.filter((target) => target.enabled).map((target) => target.spaceId)
      : [spaceId]
  )
    .map((id) => spaces.find((space) => space.id === id)?.name ?? "this Space")
    .join(", ");
  const [step, setStep] = useState<"details" | "permissions" | "remove">(
    props.reviewPermissions ? "permissions" : "details",
  );
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");
  const locked = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const busy = pending || Boolean(props.actionAppId);
  const installed = installation?.state === "installed";
  const updateAvailable = officialAppNeedsReview(app, installation);
  const addedToCurrentSpace = useAppsStore((state) => {
    const cached = state.bySpace[spaceId];
    return cached
      ? cached.some((item) => item.app_id === app.id && item.state === "installed")
      : installed;
  });
  const unsupported = (props.mobile ? app.mobile : app.desktop).runtime === "unsupported";
  const unknown = hasUnknownAppPermissions(app.scopes);
  const groups = appPermissionGroups(app.scopes);
  const source = repositoryLink(app.repository_url);
  const name = discoverAppName(app);
  const error = failure || props.error;
  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  const run = async (changes = targets) => {
    if (
      locked.current ||
      busy ||
      (changes.some((change) => change.enabled) && (unknown || unsupported))
    )
      return;
    locked.current = true;
    setPending(true);
    setFailure("");
    try {
      for (const change of changes) {
        if (useAppsStore.getState().accountId !== targetAccount.current)
          throw new Error("The account changed. Reopen the app to continue.");
        await useAppsStore.getState().setSpaceEnabled(app, change.spaceId, change.enabled);
        setTargets((current) => current.filter((target) => target.spaceId !== change.spaceId));
      }
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

  const download = async () => {
    if (locked.current || busy || unknown || unsupported) return;
    locked.current = true;
    setPending(true);
    setFailure("");
    try {
      await useAppDownloads.getState().get(app);
      setStep("details");
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : "Could not download this app. Try again.",
      );
    } finally {
      locked.current = false;
      setPending(false);
    }
  };

  const update = async () => {
    if (locked.current || busy || unknown || unsupported) return;
    locked.current = true;
    setPending(true);
    setFailure("");
    try {
      assertAppsClosedForUpdate(app.id);
      if (hasTauriInternals() && app.desktop.runtime === "downloaded" && !downloaded)
        await useAppDownloads.getState().get(app);
      if (
        useAppsStore.getState().accountId !== accountId ||
        useAppsStore.getState().spaceId !== spaceId
      )
        throw new Error("The account or Space changed. Reopen the app to continue.");
      await props.onInstall(app);
      setStep("details");
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Could not update this app. Try again.");
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
                {downloaded && (
                  <button
                    type="button"
                    className="discover-action"
                    disabled={busy}
                    onClick={() => {
                      setFailure("");
                      setStep("remove");
                    }}
                  >
                    Remove
                  </button>
                )}
                {updateAvailable && (
                  <button
                    type="button"
                    className="discover-action discover-action-primary"
                    disabled={busy || unsupported || unknown}
                    onClick={() => {
                      setPermissionPurpose("update");
                      setFailure("");
                      if (agreed) void update();
                      else setStep("permissions");
                    }}
                  >
                    {pending ? "Updating…" : "Update"}
                  </button>
                )}
                {downloaded ? (
                  <Popover modal open={pickerOpen} onOpenChange={setPickerOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className={`discover-action discover-add-trigger${addedToCurrentSpace ? "" : " discover-action-primary"}`}
                        disabled={busy}
                      >
                        <span className="discover-add-label">Add</span>
                        <span className="discover-add-chevron" aria-hidden="true">
                          <ChevronDown size={14} />
                        </span>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" side="bottom" className="discover-space-picker">
                      <AppSpaceAccessPanel
                        app={app}
                        onSelect={(changes) => {
                          setTargets(changes);
                          targetAccount.current = useAppsStore.getState().accountId;
                          setPickerOpen(false);
                          setFailure("");
                          setPermissionPurpose("spaces");
                          if (changes.some((change) => change.enabled) && !agreed)
                            setStep("permissions");
                          else void run(changes);
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                ) : !updateAvailable ? (
                  <button
                    type="button"
                    className="discover-action discover-action-primary"
                    disabled={busy || unsupported}
                    onClick={() => {
                      setPermissionPurpose("download");
                      setTargets([]);
                      setFailure("");
                      if (agreed) void download();
                      else setStep("permissions");
                    }}
                  >
                    Get
                  </button>
                ) : null}
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
              {!props.mobile && app.requires_apps?.includes("browser") && (
                <p className="discover-detail-note">
                  Website accounts on Mac also require Browser.
                </p>
              )}
              {installation?.state === "recoverable" && (
                <p className="discover-detail-note">
                  Adding this app restores its saved content in the Space.
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
      ) : step === "remove" ? (
        <>
          <DialogTitle className="discover-step-title">Remove {name} from this device?</DialogTitle>
          <DialogDescription className="discover-permissions-intro">
            This deletes the downloaded app files and its local data on this device. Local data
            cannot be restored.
          </DialogDescription>
          <p className="discover-uninstall-copy">
            Spaces using {name} will keep access, and their shared data stays intact. You won’t be
            able to use the app on this device until you get it again.
          </p>
          {error && (
            <p className="discover-error" role="alert">
              {error}
            </p>
          )}
          <footer className="discover-details-actions">
            <button className="discover-action" disabled={busy} onClick={() => setStep("details")}>
              Cancel
            </button>
            <button
              className="discover-action discover-uninstall"
              disabled={busy}
              onClick={async () => {
                if (locked.current) return;
                locked.current = true;
                setPending(true);
                setFailure("");
                try {
                  await useAppDownloads.getState().remove(app);
                  setStep("details");
                } catch (error) {
                  setFailure(
                    error instanceof Error ? error.message : "Could not remove the app. Try again.",
                  );
                } finally {
                  locked.current = false;
                  setPending(false);
                }
              }}
            >
              {pending ? "Removing…" : "Remove"}
            </button>
          </footer>
        </>
      ) : (
        <>
          <DialogTitle ref={heading} tabIndex={-1} className="discover-step-title">
            App permissions
          </DialogTitle>
          <DialogDescription className="discover-permissions-intro">
            {props.reviewPermissions
              ? `Review the permissions ${name} needs before you use it. Space access does not grant consent on your behalf.`
              : permissionPurpose === "download"
                ? `Review the permissions ${name} requests. Downloading does not add it to any Space.`
                : `${name} needs access to the following in ${spaceName}:`}
          </DialogDescription>
          <div className="discover-details-body misty-transient-scrollbar">
            {unknown && (
              <p className="discover-error" role="alert">
                This app requests access that this version of Misty cannot describe. Update Misty
                before adding it.
              </p>
            )}
            {!app.scopes.length && (
              <p className="discover-detail-note">No additional permissions requested.</p>
            )}
            {targets.some((target) => !target.enabled) && (
              <p className="discover-detail-note">
                Access will also be removed from{" "}
                {targets
                  .filter((target) => !target.enabled)
                  .map(
                    (target) =>
                      spaces.find((space) => space.id === target.spaceId)?.name ?? "a Space",
                  )
                  .join(", ")}
                . Saved content is retained.
              </p>
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
      )}
      {step === "permissions" && (
        <footer className="discover-details-actions">
          {pending && (
            <span className="discover-operation" role="status">
              <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />
              {permissionPurpose === "download" ? "Downloading…" : "Saving…"}
            </span>
          )}
          {step === "permissions" ? (
            <>
              <p className="discover-consent-copy">
                {permissionPurpose === "download"
                  ? `Your agreement applies wherever you use ${name}. You choose Space access separately.`
                  : `Your agreement applies wherever you use ${name}. Other members agree for themselves.`}
              </p>
              <button
                type="button"
                className="discover-action"
                disabled={busy}
                onClick={() => {
                  setFailure("");
                  if (props.reviewPermissions) props.onClose();
                  else {
                    setStep("details");
                    if (permissionPurpose === "spaces") setPickerOpen(true);
                  }
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="discover-action discover-action-primary"
                disabled={busy || unknown || unsupported || !accountId}
                onClick={() => {
                  useAppConsent.getState().agree(accountId, app);
                  if (props.reviewPermissions) props.onAgreed?.();
                  else
                    void (permissionPurpose === "update"
                      ? update()
                      : permissionPurpose === "download"
                        ? download()
                        : run());
                }}
              >
                {permissionPurpose === "update" ? "Agree and update" : "Agree"}
              </button>
            </>
          ) : null}
        </footer>
      )}
    </>
  );
}
