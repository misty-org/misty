import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StoreSurface, type StoreSurfaceEntry } from "./store";

const entry: StoreSurfaceEntry = {
  id: "storage_report",
  name: "Storage Report",
  version: "0.3.0",
  overview: "Find the files and types consuming space in one local folder.",
  capabilities: ["Recursive read-only folder totals"],
  whereItAppears: ["Workspace app tab from Files"],
  permissions: [],
  gettingStarted: [],
  includedTools: [],
  links: [],
  verified: true,
  featuredRank: 1,
  kind: "app",
  installed: false,
  enabled: false,
};

describe("StoreSurface", () => {
  it("keeps the Store title in the left rail and starts the workspace with search", () => {
    const html = renderToStaticMarkup(
      <StoreSurface
        entries={[entry]}
        onQueryChange={() => {}}
        query=""
        renderIcon={() => <span data-test-icon="true" />}
        renderPrimaryAction={() => <button type="button">Install</button>}
      />,
    );

    expect(html.match(/<h1>Store<\/h1>/g)).toHaveLength(1);
    expect(html).not.toContain("Discover tools for the way you work.");
    expect(html.indexOf("misty-store__brand")).toBeLessThan(
      html.indexOf("misty-store__nav"),
    );
    expect(html.indexOf("misty-store__search-bar")).toBeLessThan(
      html.indexOf("misty-store__content"),
    );
  });
});
