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
import { useCallback, useEffect, useMemo, useState } from "react";
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
  SkeletonList,
  OverflowFadeText,
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

import { CARD, errorText, ROW, State, type PiEngine } from "./PiFamilyParts";
import { CustomProviders } from "./PiFamilyCustomProviders";

// ── Subscriptions ───────────────────────────────────────────────────────────

function OauthRows({
  engine,
  active,
  onSignIn,
  onSignOut,
}: {
  engine: PiEngine;
  active: ReadonlySet<string>;
  onSignIn: (provider: PiFamilyOauthProvider) => void;
  onSignOut: (provider: PiFamilyOauthProvider) => void;
}) {
  return (
    <Section title="Subscriptions">
      <div className={CARD}>
        {PI_FAMILY_OAUTH_PROVIDERS[engine].map((provider) => {
          const signedIn = provider.statusIds.some((id) => active.has(id));
          return (
            <div className={ROW} key={provider.id}>
              <BrandTile mark={provider.mark} />
              <OverflowFadeText
                as="p"
                full={provider.detail}
                className="min-w-0 flex-1 text-sm text-cream-bright"
              >
                {provider.name}
              </OverflowFadeText>
              <State on={signedIn} label={signedIn ? "Signed in" : "Signed out"} />
              <Button
                title={
                  engine === "pi"
                    ? `pi /login ${provider.loginArg}`
                    : `omp auth-broker login ${provider.loginArg}`
                }
                onClick={() => onSignIn(provider)}
              >
                <LogIn />
                Sign in
              </Button>
              {signedIn ? (
                <Button variant="quiet" onClick={() => onSignOut(provider)}>
                  <LogOut />
                  Sign out
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
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
        <h2 className="text-body font-semibold text-cream-bright">API keys</h2>
        <SearchField
          containerClassName="w-56"
          aria-label="Filter providers"
          placeholder="Filter providers"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className={CARD}>
        {loadError ? (
          <div role="alert" className={cn(ROW, "text-sm text-cream-muted")}>
            {loadError}
          </div>
        ) : null}
        {!snapshot && !loadError ? (
          <SkeletonList lines={2} label="Reading keys" rows={4} leading="tile" />
        ) : (
          visible.map((provider) => {
            const snap = byId.get(provider.id);
            return (
              <div key={provider.id} className={ROW}>
                <BrandTile mark={provider.mark} />
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <OverflowFadeText as="p" full className="text-sm text-cream-bright">
                    {provider.name}
                  </OverflowFadeText>
                  {snap?.envVar ? (
                    <code
                      className={cn(
                        "truncate rounded border border-dashed border-charcoal-border px-1",
                        "text-micro text-cream-muted",
                      )}
                    >
                      {snap.envVar}
                    </code>
                  ) : null}
                </div>
                <SecretField
                  label={`${provider.name} key`}
                  className="w-60 max-w-full"
                  saved={snap ? snap.state === "configured" : null}
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
          <div className={cn(ROW, "text-sm text-cream-muted")}>No providers match “{query}”</div>
        ) : null}
        {snapshot && !query.trim() ? (
          <Button
            variant="quiet"
            className="w-full text-cream-muted"
            onClick={() => setShowAll((all) => !all)}
          >
            {showAll ? "Show fewer" : `Show all ${PI_FAMILY_APIKEY_PROVIDERS.length}`}
          </Button>
        ) : null}
        {snapshot ? (
          <div className="flex items-center gap-2 px-3 py-2 text-micro text-cream-muted">
            <code className="min-w-0 truncate">{snapshot.store.path}</code>
            <span className="shrink-0 rounded bg-charcoal-hover px-1">0600</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

// ── Section ─────────────────────────────────────────────────────────────────

/** Pi's or Oh My Pi's subscriptions, API keys and custom providers. */
export function PiFamilyAuthSection({ engine }: { engine: PiEngine }) {
  const [snapshot, setSnapshot] = useState<PiFamilyAuthListResult | null>(null);
  const [models, setModels] = useState<PiFamilyModelsConfigReadResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [signIn, setSignIn] = useState<SignInRequest | null>(null);
  const [signOutTarget, setSignOutTarget] = useState<PiFamilyOauthProvider | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [auth, config] = await Promise.all([
        piFamilyApi.list(engine),
        piFamilyApi.readModels(engine),
      ]);
      setSnapshot(auth);
      setModels(config);
      setLoadError(null);
    } catch (reason) {
      setLoadError(errorText(reason));
    }
  }, [engine]);

  useEffect(() => {
    setSnapshot(null);
    setModels(null);
    void refresh();
  }, [refresh]);

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
