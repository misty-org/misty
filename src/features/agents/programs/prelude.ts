/**
 * The page API a browser_run program sees (docs/plans/agent-harness.md, browser_run), defined
 * inside the sandbox over its one host call. Targets are a ref from a read ("e12"), a locator
 * ({ role, name, index }), or words describing the control ("Search button"); the host keeps
 * each tab's document, so a program never copies ids.
 */
export const programPrelude = String.raw`
"use strict";
const __call = (name, args) => __op(name, JSON.stringify(args === undefined ? {} : args)).then((text) => JSON.parse(text));
const __show = (value) => typeof value === "string" ? value : JSON.stringify(value);
const console = { log: (...values) => __log(values.map(__show).join(" ")) };
console.info = console.log;
console.warn = console.log;
console.error = console.log;
const log = console.log;

class Tab {
  constructor(info) { this.id = info.id; this.url = info.url || ""; this.title = info.title || ""; }
  /** The page as an accessibility tree with refs: { url, title, tree }. */
  read(options) { return __call("read", Object.assign({ tab: this.id }, options)); }
  /** The page's text as markdown, clipped to maxChars (default 20000). */
  text(options) { return __call("text", Object.assign({ tab: this.id }, options)); }
  /** Controls matching words: [{ ref, line }]. Takes the words, or { query | words | text }. */
  find(query, options) {
    if (query && typeof query === "object") { options = Object.assign({}, query, options); query = query.query ?? query.words ?? query.text; }
    return __call("find", Object.assign({ tab: this.id, query: String(query ?? "") }, options));
  }
  goto(url) { return __call("goto", { tab: this.id, url }); }
  click(target, options) { return this.__act("click", target, options); }
  type(target, text, options) { return this.__act("type", target, Object.assign({ text }, options)); }
  fill(target, text, options) { return this.__act("fill", target, Object.assign({ text }, options)); }
  select(target, value) { return this.__act("select", target, { values: Array.isArray(value) ? value : [value] }); }
  check(target) { return this.__act("check", target); }
  uncheck(target) { return this.__act("uncheck", target); }
  hover(target) { return this.__act("hover", target); }
  press(key, target) { return this.__act("key", target, { key }); }
  scroll(direction, amount) { return this.__act("scroll", undefined, { direction: direction || "down", amount }); }
  /** Brings the first visible text matching these words into view, so the page shows it as proof. */
  scrollTo(text) { return this.__act("scroll", undefined, { text: String(text) }); }
  /**
   * Waits for { text } to appear, { textGone } to go, or { urlIncludes }; timeoutMs up to 20000.
   * text may be a RegExp, matched against the page's text; a plain string also works alone.
   */
  async waitFor(condition) {
    if (typeof condition === "string" || condition instanceof RegExp) condition = { text: condition };
    condition = Object.assign({}, condition);
    if (condition.text instanceof RegExp) {
      const pattern = condition.text;
      const until = Date.now() + Math.min(20000, Number(condition.timeoutMs) || 10000);
      for (;;) {
        const page = await this.text({ maxChars: 60000 });
        if (pattern.test(page.text || "")) return { met: true };
        if (Date.now() >= until) return { met: false };
        await sleep(700);
      }
    }
    return __call("wait", Object.assign({ tab: this.id }, condition));
  }
  /** Marks this tab as a page the person asked to keep open: it stays awake and is shown at the end. */
  keep() { return __call("keep", { tab: this.id }); }
  __act(action, target, options) { return __call("act", Object.assign({ tab: this.id, action, target }, options)); }
}

// Names a program is unlikely to reuse for its own variables: "const tabs = await tabs()" put
// the function in its own temporal dead zone in the first live run.
/** Opens a new tab of the agent's own at url and waits for it to load. */
const __tabMethods = [
  "read", "text", "find", "goto", "click", "type", "fill", "select", "check", "uncheck", "hover",
  "press", "scroll", "scrollTo", "waitFor", "keep",
];
// A tab that was not awaited ("getTab(id).text()") works as if it had been: its methods wait for
// the tab first. A small model forgets the await, and "not a function" tells it nothing.
const __tabPromise = (promise) => new Proxy(promise, {
  get: (target, key) => {
    if (key === "then" || key === "catch" || key === "finally") return target[key].bind(target);
    if (__tabMethods.includes(key)) return (...args) => target.then((tab) => tab[key](...args));
    return undefined;
  },
});
const openTab = (url) => __tabPromise((async () => new Tab(await __call("open", { url })))());
const open = openTab;
/** The agent's own tabs in this run. */
const listTabs = async () => (await __call("tabs")).map((info) => new Tab(info));
/** A tab of the agent's own by id or a part of its address. */
const getTab = (which) => __tabPromise((async () => new Tab(await __call("tab", { which })))());
/** Records a finding (any object) in the run's results; returned with the program's answer. */
const note = (row) => __call("note", { row });
const sleep = (ms) => __call("sleep", { ms });
`;
