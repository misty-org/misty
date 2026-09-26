import { beforeEach, expect, it } from "vitest";
import { reserveAgentRestore, RESTORE_LIMITS } from "./budget";
import {
  configurePageRestore,
  isExcludedSite,
  pageRestoreSettings,
  parseSiteList,
} from "./settings";

beforeEach(() => localStorage.clear());

it("parses the excluded-site list and matches subdomains", () => {
  const sites = parseSiteList("https://www.Chase.com/login\npaypal.com, not a site\n\nkp.org");
  expect(sites).toEqual(["www.chase.com", "paypal.com", "kp.org"]);
  expect(isExcludedSite("https://secure.paypal.com/checkout", sites)).toBe(true);
  expect(isExcludedSite("https://notpaypal.com/", sites)).toBe(false);
  expect(isExcludedSite("not a url", sites)).toBe(true);
});

it("turning restore off also turns off the agent pass", () => {
  configurePageRestore({ enabled: false, agent: true, excludedSites: "" });
  expect(pageRestoreSettings()).toMatchObject({ enabled: false, agent: false });
  configurePageRestore({ enabled: true, agent: true, excludedSites: "" });
});

it("caps agent restores per switch and per day", () => {
  expect(reserveAgentRestore(RESTORE_LIMITS.tabsPerSwitch)).toBe(false);
  for (let i = 0; i < RESTORE_LIMITS.tabsPerDay; i++) expect(reserveAgentRestore(0)).toBe(true);
  expect(reserveAgentRestore(0)).toBe(false);
  // Runs older than a day no longer count.
  expect(reserveAgentRestore(0, Date.now() + 86_400_001)).toBe(true);
});
