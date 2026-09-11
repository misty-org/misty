import { uniquePagePins } from "./pagePins";
import { providerLaunchUrl, providerLoginUrls } from "./providerLoginUrls";
import {
  mistyBrowserProviders,
  type MistyAppSDK,
  type MistyNavigationItem,
} from "@misty/sdk";
import { notifyProviderAccounts } from "./accountStore";
import {
  integrationIds,
  integrationRoute,
  jiraWorkspace,
  savedWebsiteUrl,
  websiteIntegrations,
  type WebsiteAppId,
  type WebsiteIntegrationId,
} from "./websiteIntegrations";
type Storage = MistyAppSDK["storage"]["local"];
export interface WebsiteService {
  id: WebsiteIntegrationId;
  order: number;
  removing?: boolean;
}
export interface IntegrationAccount {
  id: string;
  provider: WebsiteIntegrationId;
  label: string;
  websiteUrl: string;
  removing?: boolean;
}
export interface WebsitePin {
  id: string;
  provider: WebsiteIntegrationId;
  accountId: string;
  label: string;
  url: string;
  order: number;
}
export interface WebsiteState {
  services: WebsiteService[];
  accounts: IntegrationAccount[];
  pins: WebsitePin[];
}
const prefix = "website-integration-v1:";
const key = (kind: string, id: string) => `${prefix}${kind}:${id}`;
const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(value);
const label = (value: unknown): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= 200;
function parse(value: unknown): Record<string, unknown> | undefined {
  try {
    const result: unknown =
      typeof value === "string" ? JSON.parse(value) : value;
    return result && typeof result === "object" && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : undefined;
  } catch {
    return;
  }
}
export async function loadWebsiteState(
  storage: Storage,
  app: WebsiteAppId,
): Promise<WebsiteState> {
  const keys = (await storage.keys()).filter((value) =>
    value.startsWith(prefix),
  );
  const records = await Promise.all(
    keys.map(async (k) => [k, parse(await storage.get(k))] as const),
  );
  const allowed = integrationIds(app);
  const services: WebsiteService[] = [],
    accounts: IntegrationAccount[] = [],
    pins: WebsitePin[] = [];
  for (const [k, record] of records) {
    if (!record) continue;
    if (
      k.startsWith(key("service", "")) &&
      allowed.includes(record.id as WebsiteIntegrationId) &&
      Number.isFinite(record.order)
    )
      services.push(record as unknown as WebsiteService);
    if (
      k.startsWith(key("account", "")) &&
      validId(record.id) &&
      allowed.includes(record.provider as WebsiteIntegrationId) &&
      label(record.label) &&
      typeof record.websiteUrl === "string" &&
      (record.websiteUrl ===
        providerLoginUrls[record.provider as WebsiteIntegrationId] ||
        record.websiteUrl ===
        mistyBrowserProviders[record.provider as WebsiteIntegrationId].url ||
        savedWebsiteUrl(
          record.provider as WebsiteIntegrationId,
          record.websiteUrl,
        ))
    )
      accounts.push(record as unknown as IntegrationAccount);
    if (
      k.startsWith(key("pin", "")) &&
      validId(record.id) &&
      validId(record.accountId) &&
      allowed.includes(record.provider as WebsiteIntegrationId) &&
      label(record.label) &&
      Number.isFinite(record.order) &&
      typeof record.url === "string" &&
      savedWebsiteUrl(record.provider as WebsiteIntegrationId, record.url)
    )
      pins.push(record as unknown as WebsitePin);
  }
  return {
    services: services.sort(
      (a, b) => a.order - b.order || a.id.localeCompare(b.id),
    ),
    accounts: accounts.filter((a) => services.some((s) => s.id === a.provider)),
    pins: pins
      .filter((p) =>
        accounts.some((a) => a.id === p.accountId && a.provider === p.provider),
      )
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
  };
}
async function put(storage: Storage, kind: string, id: string, value: unknown) {
  await storage.set(key(kind, id), JSON.stringify(value));
  notifyProviderAccounts();
}
export async function addWebsiteService(
  storage: Storage,
  id: WebsiteIntegrationId,
) {
  if (!(await storage.get(key("service", id))))
    await put(storage, "service", id, { id, order: Date.now() });
}
// Reuse one internal browser session; account records are compatibility storage,
// not a setup step the user must name or configure.
const pendingSessions = new WeakMap<
  Storage,
  Map<string, Promise<IntegrationAccount>>
>();
export function ensureWebsiteSession(
  storage: Storage,
  provider: WebsiteIntegrationId,
): Promise<IntegrationAccount> {
  let pending = pendingSessions.get(storage);
  if (!pending) {
    pending = new Map();
    pendingSessions.set(storage, pending);
  }
  const existing = pending.get(provider);
  if (existing) return existing;
  const task = (async () => {
    const state = await loadWebsiteState(
      storage,
      mistyBrowserProviders[provider].owner as WebsiteAppId,
    );
    const account = state.accounts.find(
      (candidate) => candidate.provider === provider,
    );
    if (account) return account;
    await addWebsiteService(storage, provider);
    const created: IntegrationAccount = {
      id: crypto.randomUUID(),
      provider,
      label: websiteIntegrations[provider].label,
      websiteUrl: providerLoginUrls[provider],
    };
    await put(storage, "account", created.id, created);
    return created;
  })().finally(() => pending!.delete(provider));
  pending.set(provider, task);
  return task;
}

export async function createWebsiteAccount(
  storage: Storage,
  provider: WebsiteIntegrationId,
  name: string,
  url: string,
) {
  const websiteUrl =
    provider === "jira" ? jiraWorkspace(url) : savedWebsiteUrl(provider, url);
  if (!label(name.trim()) || !websiteUrl)
    throw new Error(
      provider === "jira"
        ? "Enter your team's HTTPS workspace, such as https://your-team.atlassian.net."
        : "Enter an account name and a valid service website.",
    );
  const account: IntegrationAccount = {
    id: crypto.randomUUID(),
    provider,
    label: name.trim(),
    websiteUrl,
  };
  await put(storage, "account", account.id, account);
  return account;
}
export async function renameWebsiteAccount(
  storage: Storage,
  account: IntegrationAccount,
  name: string,
) {
  if (!label(name.trim()))
    throw new Error("Use an account name between 1 and 200 characters.");
  await put(storage, "account", account.id, { ...account, label: name.trim() });
}
export async function saveWebsitePin(storage: Storage, pin: WebsitePin) {
  if (!label(pin.label.trim()) || !savedWebsiteUrl(pin.provider, pin.url))
    throw new Error("Open a service page after signing in, then pin it.");
  await put(storage, "pin", pin.id, { ...pin, label: pin.label.trim() });
}
export async function deleteWebsitePin(storage: Storage, id: string) {
  await storage.delete(key("pin", id));
  notifyProviderAccounts();
}
export async function moveWebsitePin(
  storage: Storage,
  pin: WebsitePin,
  neighbor: WebsitePin,
) {
  // Only the moved record changes; unrelated pins from another pane survive.
  const state = await loadWebsiteState(
    storage,
    mistyBrowserProviders[pin.provider].owner,
  );
  const peers = state.pins.filter(
    (p) => p.provider === pin.provider && p.id !== pin.id,
  );
  const index = peers.findIndex((p) => p.id === neighbor.id);
  if (index < 0) return;
  const before = pin.order > neighbor.order;
  const low = before
    ? (peers[index - 1]?.order ?? neighbor.order - 2)
    : neighbor.order;
  const high = before
    ? neighbor.order
    : (peers[index + 1]?.order ?? neighbor.order + 2);
  await saveWebsitePin(storage, { ...pin, order: (low + high) / 2 });
}
export async function removeWebsiteAccount(
  misty: MistyAppSDK,
  account: IntegrationAccount,
) {
  // Hide all panes before native cleanup. Retain the record on failure so removal can be retried.
  await put(misty.storage.local, "account", account.id, {
    ...account,
    removing: true,
  });
  await misty.browser.removeAccount({
    id: account.provider,
    accountId: account.id,
  });
  const keys = await misty.storage.local.keys();
  for (const k of keys.filter((k) => k.startsWith(key("pin", "")))) {
    if (parse(await misty.storage.local.get(k))?.accountId === account.id)
      await misty.storage.local.delete(k);
  }
  await misty.storage.local.delete(key("page", account.id));
  await misty.storage.local.delete(key("account", account.id));
  notifyProviderAccounts();
}
export async function removeWebsiteService(
  misty: MistyAppSDK,
  service: WebsiteService,
  accounts: IntegrationAccount[],
) {
  await put(misty.storage.local, "service", service.id, {
    ...service,
    removing: true,
  });
  for (const account of accounts.filter((a) => a.provider === service.id))
    await removeWebsiteAccount(misty, account);
  await misty.storage.local.delete(key("service", service.id));
  await misty.storage.local.delete(key("selected-account", service.id));
  notifyProviderAccounts();
}
export async function saveWebsitePage(
  storage: Storage,
  account: IntegrationAccount,
  value: string,
) {
  const url = savedWebsiteUrl(account.provider, value);
  const record = parse(await storage.get(key("account", account.id)));
  if (url && record && !record.removing)
    await storage.set(key("page", account.id), url);
}
export async function restoredWebsitePage(
  storage: Storage,
  account: IntegrationAccount,
) {
  const url = await storage.get(key("page", account.id));
  return providerLaunchUrl(
    account.provider,
    (typeof url === "string" && savedWebsiteUrl(account.provider, url)) ||
      account.websiteUrl,
  );
}
export async function selectWebsiteAccount(
  storage: Storage,
  provider: WebsiteIntegrationId,
  accountId: string,
) {
  await storage.set(key("selected-account", provider), accountId);
}
export async function selectedWebsiteAccount(
  storage: Storage,
  provider: WebsiteIntegrationId,
) {
  return await storage.get(key("selected-account", provider));
}
export async function saveWebsiteDestination(
  storage: Storage,
  instance: string,
  route: string,
) {
  const url = new URL(route, "https://misty.local");
  url.searchParams.delete("providerPopup");
  url.searchParams.delete("websiteAccount");
  await storage.set(
    key("destination", instance),
    url.pathname + url.search + url.hash,
  );
}
export async function restoredWebsiteDestination(
  storage: Storage,
  instance: string,
) {
  return await storage.get(key("destination", instance));
}
export function websiteNavigation(
  app: WebsiteAppId,
  state: WebsiteState,
  spaceId?: string,
): MistyNavigationItem[] {
  const base = `/apps/${app}`;
  const native = (view: string) =>
    `${base}?provider=misty&view=${view}${app === "library" ? `&collection=${view}` : ""}${spaceId ? `&space=${encodeURIComponent(spaceId)}` : ""}`;
  const sections =
    app === "library"
      ? [
          ["recent", "All items"],
          ["favorites", "Favorites"],
          ["collections", "Collections"],
          ["albums", "Albums"],
          ["deleted", "Recently deleted"],
        ]
      : app === "journal"
        ? [
            ["notes", "Notes"],
            ["drawings", "Drawings"],
          ]
        : [
            ["tasks", "Tasks"],
            ["agenda", "Agenda"],
            ["roadmaps", "Roadmaps"],
          ];
  return [
    {
      id: "misty",
      label: "Misty",
      route: native(sections[0][0]),
      children: sections.map(([id, label]) => ({
        id,
        label,
        route: native(id),
      })),
    },
    ...state.services
      .filter((s) => !s.removing)
      .map((s) => ({
        id: s.id,
        label: websiteIntegrations[s.id].label,
        route: integrationRoute(app, s.id),
        children: uniquePagePins(state.pins)
          .filter(
            (p) =>
              p.provider === s.id &&
              state.accounts.some((a) => a.id === p.accountId && !a.removing),
          )
          .map((p) => ({
            id: `pin-${p.id}`,
            label: p.label,
            route: integrationRoute(app, s.id, p.accountId, p.id),
          })),
      })),
  ];
}
