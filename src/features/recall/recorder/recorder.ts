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
  private current?: { page: ActivePage; since: number };
  private lastRead = new Map<string, number>();
  private backoffUntil = 0;

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
    this.current = page ? { page, since: this.now() } : undefined;
    if (!page || skipReason(page, this.deps.privacy(), this.now())) return;
    this.timer = setTimeout(() => void this.capture(), DWELL_MS);
  }

  stop() {
    clearTimeout(this.timer);
    this.current = undefined;
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
      });
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 429) {
        this.backoffUntil = now + FULL_BACKOFF_MS;
        this.deps.onFull(
          error instanceof Error && error.message ? error.message : "Memory is catching up.",
        );
      }
    }
  }
}
