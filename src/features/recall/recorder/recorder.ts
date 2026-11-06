import {
  redactSecrets,
  rememberedUrl,
  skipReason,
  type PageCandidate,
  type RecallPrivacy,
} from "./privacy";
import { simhash } from "./simhash";
import { articleText } from "./pageText";

/** The page in the focused pane of the focused window, if it is a web page. */
export interface ActivePage extends PageCandidate {
  /** The browser runtime id, for reading the page. */
  runtimeId: string;
  title: string;
  /** The Space of the window the page is in; the moment is kept there. */
  spaceId?: string;
}

export interface RecorderDeps {
  privacy(): RecallPrivacy;
  readArticle(runtimeId: string): Promise<unknown>;
  record(event: {
    kind: "page";
    url: string;
    title: string;
    body: string;
    simhash: string;
    dwell_ms: number;
    occurred_at: string;
    space_id?: string;
  }): Promise<unknown>;
  /** Whether Misty's window is in front and visible. */
  attentive(): boolean;
  onFull(message: string): void;
  now?(): number;
}

/** A page is remembered after it has been in front this long. */
export const DWELL_MS = 5_000;
/** The same address is read again at most this often. */
const REVISIT_MS = 30 * 60_000;
/** A tab's address must hold still this long before the tab counts as opened on it. */
export const SETTLE_MS = 3_000;
/** After the server says it is full, wait this long before trying again. */
const FULL_BACKOFF_MS = 10 * 60_000;

/**
 * Remembers the page the person is reading: once it has been in front for a
 * few seconds, it reads the article text (forms and fields are never read),
 * strips secrets, and sends it. Private windows, agent tabs, excluded and
 * sensitive sites, and paused or switched-off Memory are skipped before the
 * page is touched.
 */
export class RecallRecorder {
  private timer?: ReturnType<typeof setTimeout>;
  private current?: { page: ActivePage; since: number; read?: boolean };
  private lastRead = new Map<string, number>();
  private backoffUntil = 0;
  private lastVisit = new Map<string, number>();
  private tabs = new Map<string, { url: string; timer: ReturnType<typeof setTimeout> }>();
  private latest = new Map<string, ActivePage>();

  constructor(private readonly deps: RecorderDeps) {}

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  /** The front page changed (or nothing is in front). */
  observe(page: ActivePage | null) {
    if (
      page &&
      this.current?.page.runtimeId === page.runtimeId &&
      this.current.page.url === page.url
    )
      return;
    clearTimeout(this.timer);
    // A page left before it was read is still a visit.
    const left = this.current;
    if (left && !left.read && left.page.runtimeId !== page?.runtimeId) {
      void this.visit(left.page, left.since);
    }
    this.current = page ? { page, since: this.now() } : undefined;
    if (!page || skipReason(page, this.deps.privacy(), this.now())) return;
    this.timer = setTimeout(() => void this.capture(), DWELL_MS);
  }

  /**
   * Every tab that is open, in front or not. A tab that settles on an address is recorded as a
   * visit (address, title, time) without being read; the tab in front is read after its dwell
   * instead, and recorded as a visit only if it is left first.
   */
  observeTabs(tabs: readonly ActivePage[], focusedId?: string) {
    const open = new Set(tabs.map((tab) => tab.runtimeId));
    for (const [id, entry] of this.tabs) {
      if (open.has(id)) continue;
      clearTimeout(entry.timer);
      this.tabs.delete(id);
      this.latest.delete(id);
    }
    for (const tab of tabs) {
      this.latest.set(tab.runtimeId, tab);
      const known = this.tabs.get(tab.runtimeId);
      if (known?.url === tab.url) continue;
      clearTimeout(known?.timer);
      const timer = setTimeout(() => {
        const now = this.latest.get(tab.runtimeId);
        if (now && now.url === tab.url && now.runtimeId !== focusedId) void this.visit(now);
      }, SETTLE_MS);
      this.tabs.set(tab.runtimeId, { url: tab.url, timer });
    }
  }

  stop() {
    clearTimeout(this.timer);
    this.current = undefined;
    for (const entry of this.tabs.values()) clearTimeout(entry.timer);
    this.tabs.clear();
    this.latest.clear();
  }

  /** Records that a page was opened, without reading it. */
  private async visit(page: ActivePage, at = this.now()) {
    const now = this.now();
    if (skipReason(page, this.deps.privacy(), now) || now < this.backoffUntil) return;
    const url = rememberedUrl(page.url);
    if (now - (this.lastVisit.get(url) ?? -Infinity) < REVISIT_MS) return;
    this.lastVisit.set(url, now);
    try {
      await this.deps.record({
        kind: "page",
        url,
        title: redactSecrets(page.title).slice(0, 300),
        body: "",
        simhash: "",
        dwell_ms: 0,
        occurred_at: new Date(at).toISOString(),
        space_id: page.spaceId,
      });
    } catch (error) {
      this.backOffIfFull(error);
    }
  }

  private backOffIfFull(error: unknown) {
    if ((error as { status?: number }).status !== 429) return;
    this.backoffUntil = this.now() + FULL_BACKOFF_MS;
    this.deps.onFull(
      error instanceof Error && error.message ? error.message : "Memory is catching up.",
    );
  }

  /** Reads and sends the page in front, if it may be remembered. */
  async capture() {
    const current = this.current;
    const now = this.now();
    if (!current || !this.deps.attentive() || now < this.backoffUntil) return;
    const { page, since } = current;
    // Settings may have changed while the page was open.
    if (skipReason(page, this.deps.privacy(), now)) return;
    const url = rememberedUrl(page.url);
    if (now - (this.lastRead.get(url) ?? -Infinity) < REVISIT_MS) return;
    this.lastRead.set(url, now);
    this.lastVisit.set(url, now);
    current.read = true;
    let body = "";
    try {
      body = redactSecrets(articleText(await this.deps.readArticle(page.runtimeId)));
    } catch {
      // No article: remember the visit by its title.
    }
    // The page may have navigated while it was being read.
    if (this.current?.page.url !== page.url) return;
    try {
      await this.deps.record({
        kind: "page",
        url,
        title: redactSecrets(page.title).slice(0, 300),
        body,
        simhash: body ? simhash(body) : "",
        dwell_ms: now - since,
        occurred_at: new Date(since).toISOString(),
        space_id: page.spaceId,
      });
    } catch (error) {
      this.backOffIfFull(error);
    }
  }
}
