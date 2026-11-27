const browserTabAgentCapabilities = [
  "browser.inspect",
  "browser.visual",
  "browser.navigate",
  "browser.act",
  "browser.snapshot",
  "browser.find",
  "browser.console",
  "browser.network",
  "browser.storage",
  "browser.verify",
  "browser.highlight",
  "browser.emulate",
  "browser.pdf",
  "browser.page_tools",
  "browser.extract",
  "browser.wait_for",
  "browser.steps",
  "browser.fill_form",
  "browser.skill",
];

export const browserTabAgentFileCapabilities = [
  ...browserTabAgentCapabilities,
  "browser.downloads.list",
  "browser.upload",
  "browser.spawn_tabs",
];
