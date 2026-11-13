// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong): PiFamilyAuthSection.tsx,
// PiFamilyOauthSection.tsx, PiFamilyApiKeySection.tsx and PiFamilyCustomSection.tsx.
// See NOTICE.

/**
 * Pi's and Oh My Pi's providers in Settings › Channels:
 *
 * - Subscriptions: which are signed in, as the CLI's own store says, and signing in or out. The
 *   CLI does that itself (Pi's `/login`, `omp auth-broker login`) in the sign-in terminal; Misty
 *   never sees the token it gets.
 * - API keys: search, featured or all, set, replace or remove. A key goes from the field straight
 *   into the CLI's own store (0600); reads carry only its masked ends.
 * - Custom providers: models.json (Pi) or models.yml (Oh My Pi), edited as text with a loose check
 *   before it is written: the whole file, or one provider's block at a time, or a provider
 *   removed, with the rest of the file left as written.
 *
 * Read when the page opens and after each change here, never on a timer. Every change tells the
 * model menus to read again, since the CLIs list models by the credentials they hold.
 */
import { LogIn, LogOut } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useCachedResource } from "@/api/cache/cached-resource";
import { DesktopSettingsSection as Section } from "@/features/settings";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  cn,
  SearchField,
  SecretField,
  Skeleton,
  SkeletonList,
  OverflowFadeText,
  Surface,
  Text,
  Tooltip,
} from "@/shared/ui";
import { BrandTile } from "../brands/BrandMark";
import { notifyCliConfigChanged } from "../channels/providers";
import { SignInDialog } from "../clis/SignInDialog";
import type { SignInRequest } from "../clis/signInApi";
import {
  piFamilyApi,
  type PiFamilyAuthListResult,
  type PiFamilyModelsConfigReadResult,
} from "./api";

import {
  PI_FAMILY_APIKEY_PROVIDERS,
  PI_FAMILY_OAUTH_PROVIDERS,
  type PiFamilyAuthUiProvider,
  type PiFamilyOauthProvider,
} from "./piFamilyAuthCatalog";

import { errorText, ROW, RowsCard, State, type PiEngine } from "./PiFamilyParts";
import { CustomProviders } from "./PiFamilyCustomProviders";

// ── Subscriptions ───────────────────────────────────────────────────────────

function OauthRows({
  engine,
  active,
  reading,
  onSignIn,
  onSignOut,
}: {
  engine: PiEngine;
  active: ReadonlySet<string>;
  /** The CLI's store is still being read for the first time, so no state is known yet. */
  reading: boolean;
  onSignIn: (provider: PiFamilyOauthProvider) => void;
  onSignOut: (provider: PiFamilyOauthProvider) => void;
}) {
  return (
    <Section title="Subscriptions">
      <RowsCard>
        {PI_FAMILY_OAUTH_PROVIDERS[engine].map((provider) => {
          const signedIn = provider.statusIds.some((id) => active.has(id));
          return (
            <div className={ROW} key={provider.id}>
              <BrandTile mark={provider.mark} />
              <Text as="p" full={provider.detail} tone="bright" className="min-w-0 flex-1 text-sm">
                {provider.name}
              </Text>
              {reading ? (
                // Not "Signed out" before the store says so: a placeholder the state's size.
                <Skeleton className="h-3.5 w-18 shrink-0" />
              ) : (
                <State on={signedIn} label={signedIn ? "Signed in" : "Signed out"} />
              )}
              <Tooltip
                content={
                  engine === "pi"
                    ? `pi /login ${provider.loginArg}`
                    : `omp auth-broker login ${provider.loginArg}`
                }
              >
                <Button onClick={() => onSignIn(provider)}>
                  <LogIn />
                  Sign in
                </Button>
              </Tooltip>
              {signedIn ? (
                <Button variant="quiet" onClick={() => onSignOut(provider)}>
                  <LogOut />
                  Sign out
                </Button>
              ) : null}
            </div>
          );
        })}
      </RowsCard>
    </Section>
  );
}

// ── API keys ────────────────────────────────────────────────────────────────

function ApiKeyRows({
  engine,
  snapshot,
  loadError,
  onChanged,
}: {
  engine: PiEngine;
  snapshot: PiFamilyAuthListResult | null;
  loadError: string | null;
  onChanged: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const byId = useMemo(
    () => new Map((snapshot?.providers ?? []).map((item) => [item.id, item])),
    [snapshot],
  );
  const visible = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    return PI_FAMILY_APIKEY_PROVIDERS.filter((provider) => {
      if (!showAll && !provider.featured && !wanted) return false;
      if (!wanted) return true;
      const env = byId.get(provider.id)?.envVar ?? "";
      return (
        provider.name.toLowerCase().includes(wanted) ||
        provider.id.includes(wanted) ||
        env.toLowerCase().includes(wanted)
      );
    });
  }, [query, showAll, byId]);

  const name = engine === "pi" ? "Pi" : "Oh My Pi";
  // A key goes straight into the CLI's own store; the field shows a failure under itself.
  const changed = async () => {
    notifyCliConfigChanged();
    await onChanged();
  };
  const save = async (provider: PiFamilyAuthUiProvider, key: string) => {
    await piFamilyApi.setApiKey(engine, provider.id, key).catch((reason: unknown) => {
      throw new Error(errorText(reason));
    });
    await changed();
  };
  const remove = async (provider: PiFamilyAuthUiProvider) => {
    await piFamilyApi.deleteCredential(engine, provider.id).catch((reason: unknown) => {
      throw new Error(errorText(reason));
    });
    await changed();
  };

  return (
    <section aria-label="API keys" className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <Text bare as="h2" size="body" weight="semibold" tone="bright">
          API keys
        </Text>
        <SearchField
          containerClassName="w-56"
          aria-label="Filter providers"
          placeholder="Filter providers"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <RowsCard>
        {loadError ? (
          <Text bare as="div" role="alert" tone="muted" className={cn(ROW, "text-sm")}>
            {loadError}
          </Text>
        ) : null}
        {!snapshot && !loadError ? (
          <ApiKeyRowsSkeleton />
        ) : (
          visible.map((provider) => {
            const snap = byId.get(provider.id);
            return (
              <div key={provider.id} className={ROW}>
                <BrandTile mark={provider.mark} />
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Text as="p" full tone="bright" className="text-sm">
                    {provider.name}
                  </Text>
                  {snap?.envVar ? (
                    <Text
                      bare
                      as="code"
                      tone="muted"
                      className="min-w-0 rounded border border-dashed px-1 text-micro"
                    >
                      <OverflowFadeText>{snap.envVar}</OverflowFadeText>
                    </Text>
                  ) : null}
                </div>
                <SecretField
                  label={`${provider.name} key`}
                  className="w-60 max-w-full"
                  // The list is read by now: a provider the CLI doesn't list has no key saved.
                  saved={snap?.state === "configured"}
                  placeholder={snap?.envVar ? `Paste ${snap.envVar}` : undefined}
                  savedText={
                    snap?.maskedKey ? `Saved, ${snap.maskedKey}` : `In ${name}'s key store`
                  }
                  removeWhat={`It's deleted from ${name}'s own key store and can't be recovered.`}
                  onSave={(key) => save(provider, key)}
                  onRemove={() => remove(provider)}
                />
              </div>
            );
          })
        )}
        {snapshot && visible.length === 0 ? (
          <Text bare as="div" tone="muted" className={cn(ROW, "text-sm")}>
            No providers match “{query}”
          </Text>
        ) : null}
        {snapshot && !query.trim() ? (
          <Button variant="quiet" className="w-full" onClick={() => setShowAll((all) => !all)}>
            {showAll ? "Show fewer" : `Show all ${PI_FAMILY_APIKEY_PROVIDERS.length}`}
          </Button>
        ) : null}
        {snapshot ? (
          <Text bare as="div" tone="muted" className="flex items-center gap-2 px-3 py-2 text-micro">
            <code className="min-w-0">
              <OverflowFadeText>{snapshot.store.path}</OverflowFadeText>
            </code>
            <Surface as="span" tone="well" radius="md" className="shrink-0 px-1">
              0600
            </Surface>
          </Text>
        ) : null}
      </RowsCard>
    </section>
  );
}

/** How many providers the list shows before "Show all". */
const FEATURED_COUNT = PI_FAMILY_APIKEY_PROVIDERS.filter((provider) => provider.featured).length;

/**
 * The key list's first read: a row per featured provider (its tile, name and key field), then
 * Show all and the store's path, each at its real height.
 */
function ApiKeyRowsSkeleton() {
  return (
    <>
      <SkeletonList
        variant="card"
        label="Reading keys"
        rows={FEATURED_COUNT}
        leading="tile"
        trailing="field"
        className="border-b"
      />
      <div aria-hidden="true" className="flex h-8 items-center justify-center">
        <Skeleton className="h-3.5 w-24" />
      </div>
      <div aria-hidden="true" className="flex items-center px-3 py-2">
        <Skeleton className="h-3.5 w-1/2" />
      </div>
    </>
  );
}

// ── Section ─────────────────────────────────────────────────────────────────

interface PiFamilyConfig {
  auth: PiFamilyAuthListResult;
  models: PiFamilyModelsConfigReadResult;
}

/** What Pi's or Oh My Pi's own files say, kept for this session per engine. */
const piFamilyKey = (engine: PiEngine) => `engine-config/pi-family:${engine}`;

/** Pi's or Oh My Pi's subscriptions, API keys and custom providers. */
export function PiFamilyAuthSection({ engine }: { engine: PiEngine }) {
  // Session only: the custom-provider file can hold keys as written, and the key list carries
  // their masked ends, so neither is copied to the cache on disk. Each engine has its own copy,
  // so switching between Pi and Oh My Pi shows the right one at once.
  const resource = useCachedResource<PiFamilyConfig>(piFamilyKey(engine), async () => {
    const [auth, models] = await Promise.all([
      piFamilyApi.list(engine),
      piFamilyApi.readModels(engine),
    ]);
    return { auth, models };
  });
  const snapshot = resource.data?.auth ?? null;
  const models = resource.data?.models ?? null;
  const loadError = resource.error ? errorText(resource.error) : null;
  const { reload } = resource;
  const refresh = useCallback(async () => {
    await reload();
  }, [reload]);
  const [signIn, setSignIn] = useState<SignInRequest | null>(null);
  const [signOutTarget, setSignOutTarget] = useState<PiFamilyOauthProvider | null>(null);

  const active = useMemo(() => new Set(snapshot?.oauthProviders ?? []), [snapshot]);

  const signOut = () => {
    const target = signOutTarget;
    setSignOutTarget(null);
    if (!target) return;
    const providerId = target.statusIds.find((id) => active.has(id));
    if (!providerId) return;
    // Pi asks which account in its own `/logout`; Oh My Pi signs out of the provider named.
    setSignIn({ engine, signOut: true, provider: engine === "omp" ? providerId : undefined });
  };

  return (
    <>
      <OauthRows
        engine={engine}
        active={active}
        reading={resource.loading}
        onSignIn={(provider) => setSignIn({ engine, provider: provider.loginArg })}
        onSignOut={setSignOutTarget}
      />
      <ApiKeyRows engine={engine} snapshot={snapshot} loadError={loadError} onChanged={refresh} />
      <CustomProviders engine={engine} config={models} onChanged={refresh} />

      <SignInDialog
        request={signIn}
        onClose={() => {
          setSignIn(null);
          // The CLI wrote its own store: read it again, and have model menus do the same.
          void refresh().then(notifyCliConfigChanged);
        }}
      />
      <AlertDialog
        open={signOutTarget != null}
        onOpenChange={(open) => (open ? undefined : setSignOutTarget(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {engine === "pi"
                ? `Open Pi to sign out of ${signOutTarget?.name}?`
                : `Sign out of ${signOutTarget?.name}?`}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={signOut}>
              {engine === "pi" ? "Open Pi" : "Sign out"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
