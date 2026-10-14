/**
 * What an agent may do in an attached browser tab: read it as an
 * accessibility tree, act on it by ref, wait without acting, and fall back to
 * browser_act's screen agent for visual work (docs/plans/agentic-browser.md).
 */
export const browserTabAgentCapabilities = [
  "browser.inspect",
  "browser.visual",
  "browser.navigate",
  "browser.act",
  "browser.snapshot",
  "browser.find",
  "browser.extract",
  "browser.wait_for",
  "browser.steps",
  "browser.fill_form",
  "browser.skill",
];

/**
 * The tab capabilities plus task files (downloads it can list and uploads)
 * and, for a running task, tabs for its sub-agents.
 */
export const browserTabAgentFileCapabilities = [
  ...browserTabAgentCapabilities,
  "browser.downloads.list",
  "browser.upload",
  "browser.spawn_tabs",
];
