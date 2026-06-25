import { expect, it } from "vitest";
import {
  providerNavigationTitles,
  providerPageTitle,
} from "./navigationTitles";
it.each([
  ["Instagram", "(2) Instagram · Messages", "Messages"],
  ["Gmail", "Inbox (1,200) - example@gmail.com - Gmail", "Inbox"],
  ["Outlook", "Budget review - Outlook", "Budget review"],
  ["Slack", "(3) #general | Slack", "#general"],
  ["Google Docs", "Project 2026 - Google Docs", "Project 2026"],
  ["Google Docs", "(2) Draft · Google Docs", "(2) Draft"],
  ["Example", "Quarter 2 · Engineering", "Quarter 2 · Engineering"],
])("cleans %s without losing meaningful content", (platform, title, expected) =>
  expect(providerPageTitle(title, platform)).toBe(expected),
);
it("uses specific tabs and platform-first headers", () => {
  expect(
    providerNavigationTitles({
      platform: "Instagram",
      title: "(2) Instagram · Messages",
      url: "https://instagram.com/direct/inbox",
      inPlatform: true,
    }),
  ).toMatchObject({
    tab: "Messages · Instagram",
    header: "Instagram · Messages",
  });
});
it("keeps actual redirect hostname and explicitly supplied account label", () => {
  expect(
    providerNavigationTitles({
      platform: "Outlook",
      title: "Fake mailbox",
      url: "https://sso.example.edu/login",
      inPlatform: false,
      accountLabel: "School",
    }),
  ).toMatchObject({
    tab: "sso.example.edu · Outlook · School",
    header: "Outlook · sso.example.edu · School",
  });
});
