import { providerNavigationTitles } from "./navigationTitles";
import { WebsiteLoader } from "./WebsiteLoader";
import { WebsiteHeader } from "./WebsiteHeader";
import { usePagePin } from "./usePagePin";
import { savedWebsiteUrl } from "./websiteIntegrations";
import { loadProviderPins } from "./providerPins";
import {
  loadWebsiteAccounts,
  saveWebsiteAccounts,
  mailProfileId,
} from "./accountStore";
import { ProviderBrandIcon } from "./ProviderBrandIcon";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MistyAppSDK,
  MistyComponentContext,
  MailAccount,
  MistyBrowserEvent,
} from "@misty/sdk";
import { SDKBrowserView } from "@misty/browser-view";
import {
  providers,
  outlookMailboxDestination,
  providerFromRoute,
  type WebsiteAccount,
} from "./providers";

type View = Awaited<ReturnType<MistyAppSDK["browser"]["create"]>>;
const selectionKey = "provider-selected-accounts-v1";
export function ProviderWorkspace({
  appId,
  misty,
  context,
  report,
}: {
  appId: "chat" | "inbox";
  misty: MistyAppSDK;
  context: MistyComponentContext;
  report(error: unknown): void;
}) {
  const provider =
    providerFromRoute(context.route, appId) ??
    (appId === "inbox" ? "google" : "instagram");
  const [accounts, setAccounts] = useState<WebsiteAccount[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const [mailAccounts, setMailAccounts] = useState<MailAccount[]>([]);
  const [availability, setAvailability] = useState<{
    available: boolean;
    persistent: boolean;
    reason?: string;
  }>();
  const [error, setError] = useState("");
  const [view, setView] = useState<View | null>(null);
  const [destination, setDestination] = useState<{
    accountId: string;
    url: string;
  }>();
  const [pageUrl, setPageUrl] = useState("");
  const [pageTitle, setPageTitle] = useState("");
  const [runtime, setRuntime] =
    useState<Extract<MistyBrowserEvent, { type: "state" }>>();
  const [attempt, setAttempt] = useState(0);
  const currentView = useRef(view);
  currentView.current = view;
  const alive = useRef(true);
  const writes = useRef(Promise.resolve());
  const latestContext = useRef(context);
  latestContext.current = context;
  const services = useMemo(
    () => ({
      misty,
      report,
      register: (
        command: Parameters<MistyAppSDK["shortcuts"]["register"]>[0],
        action: () => void,
        enabled: () => boolean,
      ) => {
        let closed = false,
          cleanup: (() => void) | undefined;
        void misty.shortcuts
          .register(command, () => {
            if (
              !closed &&
              latestContext.current.active &&
              latestContext.current.focused !== false &&
              enabled()
            )
              action();
          })
          .then((stop) => {
            if (closed) stop();
            else cleanup = stop;
          })
          .catch(report);
        return () => {
          closed = true;
          cleanup?.();
        };
      },
    }),
    [misty, report],
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const fail = useCallback((reason: unknown) => {
    if (alive.current)
      setError(reason instanceof Error ? reason.message : String(reason));
  }, []);
  const save = (next: WebsiteAccount[]) => {
    const changes = next.filter(
      (item) =>
        JSON.stringify(item) !==
        JSON.stringify(accounts.find((old) => old.id === item.id)),
    );
    setAccounts(next);
    writes.current = writes.current
      .then(() => saveWebsiteAccounts(misty.storage.local, changes))
      .catch(fail);
  };
  const refreshMail = useCallback(async () => {
    const result = await misty.server.call("mail.accounts.list");
    if (alive.current) setMailAccounts(result.accounts);
    return result.accounts;
  }, [misty]);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      loadWebsiteAccounts(misty.storage.local),
      misty.storage.local.get<Record<string, string>>(selectionKey),
    ])
      .then(([value, selection]) => {
        if (!cancelled) {
          setAccounts(value);
          const popupAccount = new URL(
            context.route,
            "https://misty.local",
          ).searchParams.get("websiteAccount");
          setSelected({
            ...(selection && typeof selection === "object" ? selection : {}),
            ...(popupAccount &&
            value.some(
              (account) =>
                account.provider === provider && account.id === popupAccount,
            )
              ? { [provider]: popupAccount }
              : {}),
          });
          setReady(true);
        }
      })
      .catch(fail);
    if (appId === "inbox") void refreshMail().catch(fail);
    return () => {
      cancelled = true;
    };
  }, [appId, misty, fail, refreshMail, attempt]);
  useEffect(() => {
    let cancelled = false;
    void misty.browser
      .availability()
      .then((value) => {
        if (!cancelled) setAvailability(value);
      })
      .catch((reason) => {
        if (!cancelled)
          setAvailability({
            available: false,
            persistent: false,
            reason: String(reason),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [misty, attempt]);
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      const additions: WebsiteAccount[] = [];
      for (const mail of mailAccounts) {
        const id = ["google", "gmail"].includes(mail.provider)
          ? "google"
          : ["microsoft", "outlook"].includes(mail.provider)
            ? "microsoft"
            : null;
        if (
          id &&
          !accounts.some(
            (account) => account.connectionId === mail.connection_id,
          )
        )
          additions.push({
            id: await mailProfileId(mail.connection_id),
            provider: id,
            label: mail.email || mail.display_name,
            email: mail.email,
            connectionId: mail.connection_id,
          });
      }
      if (
        !accounts.some((account) => account.provider === provider) &&
        !additions.some((account) => account.provider === provider)
      )
        additions.push({
          id: `default-${provider}`,
          provider,
          label: providers[provider].label,
        });
      if (!cancelled && additions.length) save([...accounts, ...additions]);
    })().catch(fail);
    return () => {
      cancelled = true;
    };
  }, [ready, provider, mailAccounts, accounts]);
  useEffect(() => {
    if (ready) void misty.storage.local.set(selectionKey, selected).catch(fail);
  }, [ready, selected, misty, fail]);
  const visibleAccounts = accounts.filter(
    (account) => account.provider === provider,
  );
  const account =
    visibleAccounts.find((account) => account.id === selected[provider]) ??
    visibleAccounts[0];
  // Saving an observed landing address must not navigate the open message.
  // A new profile/view uses its saved address; explicit choices use destination.
  const launch = useRef<{ key: string; url: string } | null>(null);
  const launchKey = `${provider}:${account?.id}:${attempt}`;
  if (launch.current?.key !== launchKey)
    launch.current = {
      key: launchKey,
      url: account?.websiteUrl ?? providers[provider].url,
    };
  const rememberMailbox = useRef<(url: string) => void>(() => {});
  rememberMailbox.current = (url) => {
    if (provider !== "microsoft" || !account) return;
    const websiteUrl = outlookMailboxDestination(url);
    const requestedMailbox =
      destination?.accountId === account.id
        ? outlookMailboxDestination(destination.url)
        : undefined;
    // A late completion from the previous website cannot undo an explicit switch.
    if (requestedMailbox && websiteUrl !== requestedMailbox) return;
    if (websiteUrl && websiteUrl !== account.websiteUrl)
      save(
        accounts.map((item) =>
          item.id === account.id ? { ...item, websiteUrl } : item,
        ),
      );
  };
  useEffect(() => {
    setView(null);
    setPageTitle("");
    setPageUrl(account?.websiteUrl ?? providers[provider].url);
    setRuntime(undefined);
  }, [provider, account?.id]);
  useEffect(() => {
    const label = providers[provider].label;
    void misty.workspace
      .setTitle(
        providerNavigationTitles({
          platform: label,
          title: pageTitle,
          url: pageUrl,
          inPlatform: !!savedWebsiteUrl(provider, pageUrl),
          accountLabel:
            accounts.filter((a) => a.provider === provider).length > 1
              ? account?.label
              : undefined,
        }).tab,
      )
      .catch(report);
  }, [
    misty,
    provider,
    pageUrl,
    pageTitle,
    account?.label,
    accounts.length,
    report,
  ]);
  useEffect(() => {
    let closed = false;
    void loadProviderPins(misty.storage.local)
      .then((value) => {
        if (closed) return;
        const params = new URL(context.route, "https://misty.local")
          .searchParams;
        const requested = value.find(
          (p) =>
            p.id === params.get("pin") &&
            p.provider === provider &&
            p.accountId === params.get("websiteAccount"),
        );
        if (requested) {
          setSelected((current) => ({
            ...current,
            [provider]: requested.accountId,
          }));
          setDestination({
            accountId: requested.accountId,
            url: requested.url,
          });
        }
      })
      .catch(fail);
    return () => {
      closed = true;
    };
  }, [context.route, misty, provider, fail]);
  const onView = useCallback((next: View | null) => setView(next), []);
  const pin = usePagePin({
    misty,
    appId,
    provider,
    accountId: account?.id,
    url: pageUrl,
    title: pageTitle,
    label: providers[provider].label,
    report: fail,
  });
  useEffect(() => {
    if (!view) return;
    let closed = false,
      stop: (() => void) | undefined;
    void misty.browser
      .subscribe(view.handle, (event) => {
        if (closed) return;
        if (event.type === "state") setRuntime(event);
        if (event.type === "title") setPageTitle(event.title);
        if (event.type === "page") {
          setPageUrl(event.url);
          if (
            event.phase === "finished" &&
            launch.current?.key === launchKey &&
            currentView.current?.handle === view.handle
          )
            rememberMailbox.current(event.url);
        }
      })
      .then((cleanup) => {
        if (closed) cleanup();
        else stop = cleanup;
      })
      .catch(fail);
    return () => {
      closed = true;
      stop?.();
    };
  }, [view, misty, fail, launchKey]);
  const toolbar = (
    <WebsiteHeader
      key={`header:${provider}:${account?.id}`}
      active={context.active}
      route={context.route}
      misty={misty}
      view={view}
      label={providers[provider].label}
      providerId={provider}
      icon={<ProviderBrandIcon provider={provider} />}
      url={pageUrl}
      title={pageTitle}
      accountLabel={
        accounts.filter((a) => a.provider === provider).length > 1
          ? account?.label
          : undefined
      }
      loading={runtime?.loading}
      onPin={() => void pin.toggle()}
      pinned={pin.pinned}
      pinBusy={pin.busy}
      canPin={!!view && pin.ready && !!savedWebsiteUrl(provider, pageUrl)}
      canOpenExternal={!!savedWebsiteUrl(provider, pageUrl)}
      report={fail}
    />
  );
  const notices = (
    <>
      {!availability?.persistent && availability?.available && (
        <p className="provider-notice">
          This macOS version cannot persist isolated website logins. Sign-in may
          be required again after closing the view.
        </p>
      )}
      {error && (
        <p className="provider-notice" role="alert">
          {error}
          <button onClick={() => setError("")}>Dismiss</button>
        </p>
      )}
    </>
  );
  if (!ready || !account)
    return (
      <section className="provider-workspace">
        {error ? (
          <div className="provider-panel" role="alert">
            <p>{error}</p>
            <button onClick={() => setAttempt((value) => value + 1)}>
              Retry
            </button>
          </div>
        ) : (
          <WebsiteLoader />
        )}
      </section>
    );
  return (
    <section
      className="provider-workspace"
      data-provider={provider}
      data-browser-page-container
    >
      {toolbar}
      {notices}
      <div className="provider-canvas">
        {availability?.available ? (
          <SDKBrowserView
            key={`${provider}:${account.id}:${attempt}`}
            services={services}
            context={context}
            provider={{ id: provider, accountId: account.id }}
            initialUrl={
              destination?.accountId === account.id
                ? destination.url
                : launch.current.url
            }
            onView={onView}
          />
        ) : !availability ? (
          <WebsiteLoader />
        ) : (
          <>
            <div className="provider-panel" role="status">
              <p>{availability.reason}</p>
              <button onClick={() => setAttempt((value) => value + 1)}>
                Retry
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
