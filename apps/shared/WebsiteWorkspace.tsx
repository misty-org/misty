import { providerNavigationTitles } from "./navigationTitles";
import { WebsiteLoader } from "./WebsiteLoader";
import { PlatformPanel } from "./PlatformPanel";
import { useWebsiteOverlay } from "./useWebsiteOverlay";
import { WebsiteHeader } from "./WebsiteHeader";
import { usePagePin } from "./usePagePin";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  mistyBrowserProviders,
  type MistyAppSDK,
  type MistyComponentContext,
  type MistyBrowserEvent,
} from "@misty/sdk";
import { SDKBrowserView } from "@misty/browser-view";
import { WebsiteBrandIcon } from "./WebsiteBrandIcon";
import {
  integrationRoute,
  savedWebsiteUrl,
  websiteIntegrations,
  type WebsiteAppId,
  type WebsiteIntegrationId,
} from "./websiteIntegrations";
import {
  createWebsiteAccount,
  restoredWebsitePage,
  saveWebsitePage,
  selectWebsiteAccount,
  selectedWebsiteAccount,
} from "./websiteStore";
import { useWebsiteState } from "./useWebsiteState";
type View = Awaited<ReturnType<MistyAppSDK["browser"]["create"]>>;
type Availability = Awaited<ReturnType<MistyAppSDK["browser"]["availability"]>>;
export function WebsiteWorkspace({
  appId,
  provider,
  misty,
  context,
  report,
}: {
  appId: WebsiteAppId;
  provider: WebsiteIntegrationId;
  misty: MistyAppSDK;
  context: MistyComponentContext;
  report(error: unknown): void;
}) {
  const { state, error: loadError, retry } = useWebsiteState(misty, appId);
  const info = websiteIntegrations[provider];
  const params = new URL(context.route, "https://misty.local").searchParams;
  const requestedAccount = params.get("account"),
    requestedPin = params.get("pin");
  const [selected, setSelected] = useState<string>(),
    [initialUrl, setInitialUrl] = useState("");
  const [availability, setAvailability] = useState<Availability>(),
    [attempt, setAttempt] = useState(0);
  const [panel, setPanel] = useState<"add" | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [name, setName] = useState(""),
    [workspace, setWorkspace] = useState("");
  const [view, setView] = useState<View | null>(null),
    [url, setUrl] = useState(""),
    [title, setTitle] = useState("");
  const [runtime, setRuntime] =
    useState<Extract<MistyBrowserEvent, { type: "state" }>>();
  const accounts = state?.accounts.filter((a) => a.provider === provider) ?? [];
  const account = accounts.find((a) => a.id === selected);
  const service = state?.services.find((s) => s.id === provider);
  const browserProvider = useMemo(
    () => (account ? { id: provider, accountId: account.id } : undefined),
    [provider, account?.id],
  );
  const services = useMemo(
    () => ({ misty, report, register: () => () => {} }),
    [misty, report],
  );
  useEffect(() => {
    let closed = false;
    setAvailability(undefined);
    void misty.browser
      .availability()
      .then((value) => {
        if (!closed) setAvailability(value);
      })
      .catch(() => {
        if (!closed)
          setAvailability({
            available: false,
            persistent: false,
            reason:
              "Website support could not be checked. Retry, or update Misty if this continues.",
          });
      });
    return () => {
      closed = true;
    };
  }, [misty, attempt]);
  useEffect(() => {
    setPanel(null);
  }, [requestedPin, requestedAccount]);
  useEffect(() => {
    if (!state) return;
    let closed = false;
    void selectedWebsiteAccount(misty.storage.local, provider)
      .then((remembered) => {
        if (closed) return;
        setSelected(
          (current) =>
            accounts.find((a) => a.id === requestedAccount)?.id ??
            accounts.find((a) => a.id === current)?.id ??
            accounts.find((a) => a.id === remembered)?.id ??
            accounts[0]?.id,
        );
      })
      .catch(report);
    return () => {
      closed = true;
    };
  }, [state, misty, provider, requestedAccount, report]);
  useEffect(() => {
    setInitialUrl("");
    setRuntime(undefined);
    setTitle("");
    if (!account || account.removing) return;
    let closed = false;
    const pin = state?.pins.find(
      (p) =>
        p.id === requestedPin &&
        p.accountId === account.id &&
        p.provider === provider,
    );
    void restoredWebsitePage(misty.storage.local, account)
      .then((restored) => {
        if (!closed) {
          const next = pin?.url ?? restored;
          setInitialUrl(next);
          setUrl(next);
        }
      })
      .catch(report);
    void selectWebsiteAccount(misty.storage.local, provider, account.id).catch(
      report,
    );
    return () => {
      closed = true;
    };
  }, [account?.id, account?.removing, requestedPin, misty, provider, report]);
  useEffect(() => {
    void misty.workspace
      .setTitle(
        providerNavigationTitles({
          platform: info.label,
          title,
          url,
          inPlatform: !!savedWebsiteUrl(provider, url),
          accountLabel: accounts.length > 1 ? account?.label : undefined,
        }).tab,
      )
      .catch(report);
  }, [
    misty,
    provider,
    url,
    info.label,
    title,
    account?.label,
    accounts.length,
    report,
  ]);
  const onView = useCallback((next: View | null) => setView(next), []);
  useEffect(() => {
    if (!view || !account) return;
    let closed = false,
      stop: (() => void) | undefined;
    void misty.browser
      .subscribe(view.handle, (event) => {
        if (closed) return;
        if (event.type === "state") setRuntime(event);
        if (event.type === "title")
          setTitle(
            event.title.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200),
          );
        if (event.type === "page") {
          setUrl(event.url);
          if (event.phase === "finished")
            void saveWebsitePage(misty.storage.local, account, event.url).catch(
              report,
            );
        }
      })
      .then((unsubscribe) => {
        if (closed) unsubscribe();
        else stop = unsubscribe;
      })
      .catch(report);
    return () => {
      closed = true;
      stop?.();
    };
  }, [view, misty, account?.id, report]);
  const pinReport = useCallback((reason: unknown) => {
    setError(reason instanceof Error ? reason.message : String(reason));
  }, []);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  const supported =
    availability?.available &&
    availability.persistent &&
    availability.supportedProviders?.includes(provider);
  const reason =
    availability &&
    (!availability.available
      ? availability.reason
      : !supported
        ? `Update Misty to open ${info.label} here.`
        : undefined);
  const pin = usePagePin({
    misty,
    appId,
    provider,
    accountId: account?.id,
    url,
    title,
    label: info.label,
    report: pinReport,
  });
  const canvas =
    !!account &&
    !account.removing &&
    !service?.removing &&
    !!initialUrl &&
    supported;
  const overlayReady = useWebsiteOverlay(misty, view, !!panel, context.active);
  const visiblePanel = overlayReady ? panel : null;
  return (
    <section
      data-browser-page-container
      className="provider-workspace website-workspace"
      onKeyDown={(event) => {
        if (event.key === "Escape" && panel) {
          event.stopPropagation();
          setPanel(null);
        }
      }}
    >
      <WebsiteHeader
        key={`header:${provider}:${account?.id}`}
        active={context.active}
        route={context.route}
        misty={misty}
        view={canvas ? view : null}
        label={info.label}
        providerId={provider}
        icon={<WebsiteBrandIcon id={provider} />}
        url={url}
        title={title}
        accountLabel={accounts.length > 1 ? account?.label : undefined}
        loading={runtime?.loading}
        onPin={() => void pin.toggle()}
        pinned={pin.pinned}
        pinBusy={pin.busy}
        canPin={!!canvas && pin.ready && !!savedWebsiteUrl(provider, url)}
        canOpenExternal={!!savedWebsiteUrl(provider, url)}
        report={(reason) =>
          void run(async () => {
            throw reason;
          })
        }
      />
      {(error || loadError) && (
        <p className="provider-notice" role="alert">
          {error || loadError}{" "}
          {loadError ? (
            <button onClick={retry}>Retry</button>
          ) : (
            <button onClick={() => setError("")}>Dismiss</button>
          )}
        </p>
      )}
      {(!state && !loadError) || !availability ? (
        <WebsiteLoader />
      ) : reason ? (
        <div className="website-empty">
          <h2>Website support needs attention</h2>
          <p>{reason}</p>
          <button onClick={() => setAttempt((n) => n + 1)}>Retry</button>
          <button
            onClick={() =>
              void run(() =>
                misty.navigation.open(`/apps/${appId}?provider=misty`),
              )
            }
          >
            Open Misty
          </button>
        </div>
      ) : null}
      {supported && state && !service && (
        <div className="website-empty">
          <h2>Add {info.label} to get started</h2>
          <p>Choose a website to set up a profile.</p>
          <button
            onClick={() =>
              void run(() =>
                misty.navigation.open(`/apps/${appId}?view=integrations`),
              )
            }
          >
            Choose a website
          </button>
        </div>
      )}
      <PlatformPanel
        open={
          context.active &&
          params.get("drawer") !== "integrations" &&
          !!supported &&
          !!service &&
          (!!visiblePanel || (!account && !service.removing))
        }
        compact
        title="Set up"
        onClose={() => {
          setPanel(null);
          if (!account || account.removing || service?.removing)
            void run(() =>
              misty.navigation.open(`/apps/${appId}?view=integrations`),
            );
        }}
      >
        {supported && service && (visiblePanel === "add" || !account) && (
          <div className="provider-panel website-management">
            {!service.removing && (
              <form
                className="website-account-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    const created = await createWebsiteAccount(
                      misty.storage.local,
                      provider,
                      name,
                      provider === "jira"
                        ? workspace
                        : provider === "outlook-calendar" &&
                            workspace === "work"
                          ? "https://outlook.office.com/calendar/"
                          : mistyBrowserProviders[provider].url,
                    );
                    setName("");
                    setWorkspace("");
                    setSelected(created.id);
                    setPanel(null);
                    await selectWebsiteAccount(
                      misty.storage.local,
                      provider,
                      created.id,
                    );
                    await misty.navigation.open(
                      integrationRoute(appId, provider, created.id),
                    );
                  });
                }}
              >
                <label>
                  Profile name
                  <input
                    autoFocus={!accounts.length}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Personal or Work"
                    required
                    maxLength={200}
                  />
                </label>
                {provider === "jira" && (
                  <label>
                    Jira Cloud workspace
                    <input
                      value={workspace}
                      onChange={(event) => setWorkspace(event.target.value)}
                      aria-label="Jira Cloud workspace"
                      placeholder="https://your-team.atlassian.net"
                      type="url"
                      required
                    />
                    <small>Use your team's atlassian.net address.</small>
                  </label>
                )}
                {provider === "outlook-calendar" && (
                  <label>
                    Account type
                    <select
                      value={workspace}
                      onChange={(event) => setWorkspace(event.target.value)}
                    >
                      <option value="">Personal Outlook account</option>
                      <option value="work">Work or school account</option>
                    </select>
                  </label>
                )}
                <button disabled={busy || !name.trim()} type="submit">
                  {busy ? "Opening…" : "Continue to sign in"}
                </button>
              </form>
            )}
          </div>
        )}
      </PlatformPanel>
      {canvas && (
        <div className="provider-canvas">
          <SDKBrowserView
            key={account.id}
            services={services}
            context={context}
            provider={browserProvider}
            initialUrl={initialUrl}
            onView={onView}
          />
        </div>
      )}
      {canvas && url && !savedWebsiteUrl(provider, url) && (
        <p className="provider-notice" role="status">
          You are temporarily outside {info.label}. Complete sign-in to
          continue.
        </p>
      )}
    </section>
  );
}
