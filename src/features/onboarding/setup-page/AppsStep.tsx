import { Check, ChevronDown, ExternalLink, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AppLogo, appsApi, DirectApps, type ConnectedApp } from "@/features/agents";
import { useSavedModelKeys } from "@/features/agents/modelKeysPublic";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import { Button, cn, IconButton, Input, OverflowFadeText, Skeleton, useNotice } from "@/shared/ui";

/** Composio's dashboard, where a person makes the key connected apps run on. */
const COMPOSIO_KEYS_URL = "https://platform.composio.dev";

/** Apps people use most whose makers don't offer a direct sign-in yet, so they go through
 * Composio. */
const FEATURED_APPS = [
  { app: "gmail", name: "Gmail" },
  { app: "googlecalendar", name: "Google Calendar" },
  { app: "googledrive", name: "Google Drive" },
  { app: "slack", name: "Slack" },
  { app: "github", name: "GitHub" },
  { app: "outlook", name: "Outlook" },
  { app: "hubspot", name: "HubSpot" },
  { app: "asana", name: "Asana" },
] as const;

const cardClass = "rounded-[12px] border border-charcoal-border bg-charcoal-card";

const message = (reason: unknown, fallback: string) =>
  reason instanceof Error ? reason.message : typeof reason === "string" ? reason : fallback;

/**
 * The second step: apps signed in directly on their makers' own pages first, no key needed. Apps
 * whose makers don't offer that (Gmail, Slack and the like) go through Composio on the person's
 * own key, folded away until asked for. Keys go to the keychain and only native code reads them.
 */
export function AppsStep() {
  const [composio, setComposio] = useState(false);
  return (
    <div className="grid gap-4">
      <DirectApps limit={8} />
      <Button
        variant="quiet"
        className="justify-self-start text-cream-muted"
        aria-expanded={composio}
        onClick={() => setComposio((open) => !open)}
      >
        <ChevronDown className={cn("transition-transform", composio && "rotate-180")} />
        Gmail, Slack and more through Composio
      </Button>
      {composio ? <ComposioApps /> : null}
    </div>
  );
}

function ComposioApps() {
  const keys = useSavedModelKeys();
  const hasKey = keys.saved?.includes("composio") ?? null;
  if (hasKey === null)
    return <Skeleton aria-label="Apps" className="h-[148px] w-full rounded-[12px]" />;
  return hasKey ? <AppTiles /> : <ComposioKey keys={keys} />;
}

function ComposioKey({ keys }: { keys: ReturnType<typeof useSavedModelKeys> }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const shownError = error || keys.error || "";
  useNotice(Boolean(shownError), { message: shownError, tone: "error" });
  const save = async () => {
    const value = key.trim();
    if (!value || busy) return;
    setBusy(true);
    setError("");
    const saved = await keys.save("composio", value);
    if (saved) {
      // A key Composio turns down is taken back out, so the apps step never shows a dead grid.
      try {
        await appsApi.catalog("");
      } catch (reason) {
        await keys.remove("composio");
        setError(message(reason, "Composio didn’t accept that key."));
      }
    }
    setBusy(false);
  };
  return (
    <div className={`${cardClass} grid gap-4 p-4`}>
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center">
          <AppLogo app="composio" size={18} />
        </span>
        <p className="min-w-0 flex-1 text-sm font-medium text-cream-bright">Composio key</p>
        <Button
          variant="quiet"
          onClick={() => void openExternalLink(COMPOSIO_KEYS_URL).catch(() => {})}
        >
          <ExternalLink />
          Get a free key
        </Button>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          aria-label="Composio key"
          placeholder="Paste your key"
          value={key}
          disabled={busy}
          className="min-w-0 flex-1"
          onChange={(event) => setKey(event.target.value)}
        />
        <Button type="submit" variant="secondary" disabled={busy || !key.trim()}>
          {busy ? "Checking" : "Save"}
        </Button>
      </form>
    </div>
  );
}

function AppTiles() {
  const [apps, setApps] = useState<ConnectedApp[] | null>(null);
  const [pending, setPending] = useState<{ app: string; name: string; known: string[] } | null>(
    null,
  );
  const [error, setError] = useState("");
  useNotice(Boolean(error), { message: error, tone: "error" });
  const load = useCallback(async () => {
    try {
      setApps((await appsApi.list()).apps);
    } catch (reason) {
      setError(message(reason, "Apps could not be loaded."));
      setApps([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // The sign-in happens in the browser: look again each time Misty comes back to the front.
  useEffect(() => {
    if (!pending) return;
    const check = () => void load();
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [pending, load]);
  const active = (app: string) =>
    (apps ?? []).filter((item) => item.app === app && item.status === "active");
  useEffect(() => {
    if (pending && active(pending.app).some((item) => !pending.known.includes(item.id)))
      setPending(null);
    // `active` reads `apps`, which is what this waits on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps, pending]);
  const connect = async (app: string, name: string) => {
    setError("");
    try {
      const { url } = await appsApi.connect(app);
      setPending({ app, name, known: active(app).map((item) => item.id) });
      await openExternalLink(url);
    } catch (reason) {
      setPending(null);
      setError(message(reason, `${name} couldn’t be connected.`));
    }
  };
  return (
    <div className="grid gap-3">
      {pending ? (
        <p role="status" className="text-sm text-cream-muted">
          Finish signing in to {pending.name} in your browser, then come back here.
        </p>
      ) : null}
      <ul aria-label="Apps" className="grid grid-cols-2 gap-2">
        {FEATURED_APPS.map(({ app, name }) => {
          const connected = active(app).length > 0;
          return (
            <li key={app} className={`${cardClass} flex min-h-[56px] items-center gap-3 px-3 py-2`}>
              <span className="flex size-8 shrink-0 items-center justify-center">
                <AppLogo app={app} size={18} />
              </span>
              <OverflowFadeText as="p" className="flex-1 text-sm font-medium text-cream-bright">
                {name}
              </OverflowFadeText>
              {apps === null ? (
                <Skeleton className="size-8 rounded-md" />
              ) : connected ? (
                <Check aria-label={`${name} connected`} className="mx-2 size-4 text-cream-bright" />
              ) : (
                <IconButton
                  variant="quiet"
                  label={`Connect ${name}`}
                  disabled={pending?.app === app}
                  onClick={() => void connect(app, name)}
                >
                  <Plus />
                </IconButton>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
