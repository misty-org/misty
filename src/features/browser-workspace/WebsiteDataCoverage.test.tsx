import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { WebsiteDataCoverage } from "./WebsiteDataCoverage";
import { skippedLabel, websiteDataSummary, type WebsiteDataSite } from "./websiteData";

afterEach(cleanup);

const sites: WebsiteDataSite[] = [
  {
    site: "mail.example.test",
    synced: [
      { kind: "cookies", count: 12 },
      { kind: "local_storage", count: 1 },
    ],
    skipped: [
      { kind: "indexed_db", reason: "too_large", count: 2 },
      { kind: "cookies", reason: "partitioned", count: 1 },
    ],
  },
  { site: "docs.example.test", synced: [{ kind: "cookies", count: 3 }], skipped: [] },
];

it("leads with sites whose data is partly unsynced and explains why", () => {
  render(<WebsiteDataCoverage sites={sites} />);
  expect(screen.getByRole("status").textContent).toBe("Some data on 1 site can’t sync");
  expect(screen.getByText("Synced: 12 cookies, local storage (1 item)")).toBeTruthy();
  expect(screen.getByText("Not synced · 2 databases: too large to sync")).toBeTruthy();
  expect(
    screen.getByText("Not synced · 1 cookie: partitioned cookies can’t be copied between devices"),
  ).toBeTruthy();
  // Fully synced sites stay tucked away until asked for.
  expect(screen.queryByText("docs.example.test")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Fully synced sites \(1\)/ }));
  expect(screen.getByText("docs.example.test")).toBeTruthy();
});

it("renders nothing before the first capture and summarizes complete syncs", () => {
  const { container } = render(<WebsiteDataCoverage sites={[]} />);
  expect(container.textContent).toBe("");
  expect(websiteDataSummary([sites[1]])).toBe("All website data on 1 site syncs");
  expect(skippedLabel({ kind: "local_storage", reason: "unreadable", count: 1 })).toBe(
    "Local storage: couldn’t be read this time; retrying automatically",
  );
});
