import { expect, it } from "vitest";
import { isExcludedSite, parseSiteList } from "./settings";

it("parses the excluded-site list and matches subdomains", () => {
  const sites = parseSiteList("https://www.Chase.com/login\npaypal.com, not a site\n\nkp.org");
  expect(sites).toEqual(["www.chase.com", "paypal.com", "kp.org"]);
  expect(isExcludedSite("https://secure.paypal.com/checkout", sites)).toBe(true);
  expect(isExcludedSite("https://notpaypal.com/", sites)).toBe(false);
  expect(isExcludedSite("not a url", sites)).toBe(true);
});
