import type { OfficialApp, UserAppInstallation } from "@/api/apps";
import { OfficialAppIcon } from "@/features/apps/OfficialAppIcon";
import { appPermissionLabel } from "@/features/apps/appPermissions";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui/dialog";
import { ShieldCheck } from "lucide-react";
import { useRef } from "react";
import {
  discoverAppAction,
  discoverAppName,
  discoverAppPlatform,
  discoverAppSize,
} from "./discoverModel";

export function DiscoverAppDetails(props: {
  app: OfficialApp | undefined;
  installation?: UserAppInstallation;
  actionAppId: string;
  mobile: boolean;
  error: string;
  onClose: () => void;
  onRestoreFocus: () => void;
  onInstall: (app: OfficialApp) => void;
  onOpen: (app: OfficialApp) => void;
  onRemove: (app: OfficialApp) => void;
}) {
  const { app, installation } = props;
  const action = app ? discoverAppAction(app, installation, props.mobile) : "Add";
  const busy = Boolean(props.actionAppId);
  const unavailable = action === "Unavailable";
  const openingApp = useRef(false);
  return (
    <Dialog open={Boolean(app)} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent
        className="discover-details"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!openingApp.current) props.onRestoreFocus();
          openingApp.current = false;
        }}
      >
        {app ? (
          <>
            <div className="discover-details-heading">
              <OfficialAppIcon appId={app.id} size={56} />
              <div>
                <DialogTitle className="discover-app-name">
                  {discoverAppName(app)}
                  {app.official ? (
                    <ShieldCheck
                      size={16}
                      className="discover-verified"
                      aria-label="Official Misty app"
                    />
                  ) : null}
                </DialogTitle>
                <p className="discover-publisher">
                  {app.publisher} <span aria-hidden="true">·</span> v{app.version}
                </p>
              </div>
            </div>
            <DialogDescription className="discover-details-summary">
              {app.description}
            </DialogDescription>
            <div className="discover-details-body misty-transient-scrollbar">
              {installation?.state === "recoverable" ? (
                <p className="discover-recovery">
                  Adding this app restores its recoverable saved data.
                </p>
              ) : null}
              {action === "Review" ? (
                <p className="discover-recovery">
                  This update changes the app’s access. Review its permissions before updating.
                </p>
              ) : null}
              <section className="discover-details-section" aria-label="About">
                <h3>About</h3>
                <dl className="discover-facts">
                  <div>
                    <dt>Available on</dt>
                    <dd>{discoverAppPlatform(app)}</dd>
                  </div>
                  <div>
                    <dt>Download size</dt>
                    <dd>{discoverAppSize(app, props.mobile)}</dd>
                  </div>
                  <div>
                    <dt>Age rating</dt>
                    <dd>{app.age_rating}</dd>
                  </div>
                </dl>
              </section>
              <section className="discover-details-section" aria-label="Permissions">
                <h3>Permissions</h3>
                <p className="discover-permissions-intro">
                  This app can access the following through Misty:
                </p>
                {app.scopes.length ? (
                  <ul className="discover-permissions">
                    {app.scopes.map((scope) => (
                      <li key={scope}>{appPermissionLabel(scope)}</li>
                    ))}
                  </ul>
                ) : (
                  <p>No additional permissions requested.</p>
                )}
              </section>
              <section className="discover-details-section" aria-label="Where it appears">
                <h3>Where it appears</h3>
                <p>
                  Opens as a workspace tab. Apps you add are available on your signed-in devices.
                </p>
              </section>
              {props.error ? (
                <p className="discover-error" role="alert">
                  {props.error}
                </p>
              ) : null}
              {unavailable ? (
                <p className="discover-permissions-intro">
                  This app isn’t available on this device.
                </p>
              ) : null}
            </div>
            <footer className="discover-details-actions">
              {installation?.state === "installed" ? (
                <button
                  type="button"
                  className="discover-action discover-remove"
                  disabled={busy}
                  onClick={() => props.onRemove(app)}
                >
                  Remove app
                </button>
              ) : null}
              <button type="button" className="discover-action" onClick={props.onClose}>
                Cancel
              </button>
              <button
                type="button"
                className={`discover-action ${action === "Open" ? "" : "discover-action-primary"}`}
                disabled={busy || unavailable}
                aria-label={action === "Add" ? "Add to Misty" : undefined}
                onClick={() => {
                  if (action === "Open") {
                    openingApp.current = true;
                    props.onClose();
                    props.onOpen(app);
                  } else {
                    props.onInstall(app);
                  }
                }}
              >
                {props.actionAppId === app.id
                  ? "Working…"
                  : action === "Review"
                    ? "Approve update"
                    : action}
              </button>
            </footer>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
