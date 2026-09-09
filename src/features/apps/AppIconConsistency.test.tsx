import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkspaceTabGroupButton } from "@/application/layouts/DesktopLayout/WorkspaceTabGroupButton";
import { mobileNavigationIcons } from "@/application/layouts/MobileLayout/MobileNavigation";
import { desktopNavItems } from "@/application/routing/navigation";
import { WorkspaceAppIcon, workspaceAppIcon } from "@/features/workspace/WorkspaceAppIcon";
import { WORKSPACE_TOOLS_META } from "@/features/workspace/useRecentToolsStore";
import type { WorkspaceTab } from "@/features/workspace/model";
import { OfficialAppIcon } from "./OfficialAppIcon";

function glyph(markup: string) {
  const container = document.createElement("div");
  container.innerHTML = markup;
  const svg = container.querySelector("svg")!;
  return { paths: svg.innerHTML, strokeWidth: svg.getAttribute("stroke-width") };
}

describe("app icon consistency", () => {
  it.each(Object.values(WORKSPACE_TOOLS_META))(
    "shares $label's glyph across Discover, navbar, picker, and migrated tabs",
    ({ id, label, icon: Icon }) => {
      const catalogId = id === "social" ? "chat" : id;
      const discover = glyph(renderToStaticMarkup(<OfficialAppIcon appId={catalogId} />));
      for (const size of ["nav", "picker", "marketplace"] as const) {
        expect(glyph(renderToStaticMarkup(<WorkspaceAppIcon appId={id} size={size} />))).toEqual(
          discover,
        );
      }
      expect(glyph(renderToStaticMarkup(<Icon />))).toEqual(discover);
      for (const slug of new Set([catalogId, id])) {
        const tab: WorkspaceTab = {
          id: `tab-${slug}`,
          surfaceId: "official-app",
          groupKey: `app:${catalogId}`,
          instanceKey: catalogId,
          route: `/apps/${slug}?space=example`,
          title: label,
          sidebarVisible: true,
          state: id === "browser" ? { url: "about:blank" } : {},
          createdAt: 1,
          lastFocusedAt: 1,
        };
        const markup = renderToStaticMarkup(
          <WorkspaceTabGroupButton
            group={{
              key: tab.groupKey,
              surfaceId: tab.surfaceId,
              label,
              tabs: [tab],
              storeGroupKey: tab.groupKey,
            }}
            activeTabId={tab.id}
            canClose={false}
            lastUsedTabByGroup={{}}
            onOpen={() => {}}
            onClose={() => {}}
            onMoveTab={() => {}}
          />,
        );
        expect(glyph(markup)).toEqual(discover);
      }
    },
  );

  it("uses the same app identities in mobile and desktop navigation", () => {
    for (const [id, Icon] of Object.entries(mobileNavigationIcons)) {
      if (id === "apps" || id === "settings") continue;
      expect(Icon).toBe(workspaceAppIcon(id === "store" ? "marketplace" : id));
    }
    for (const item of desktopNavItems) {
      expect(item.icon).toBe(workspaceAppIcon(item.id));
    }
  });

  it("handles unknown catalog apps without treating inherited object keys as icons", () => {
    for (const appId of ["unknown-app", "constructor", "__proto__"]) {
      expect(workspaceAppIcon(appId)).toBeUndefined();
      expect(glyph(renderToStaticMarkup(<OfficialAppIcon appId={appId} />))).toEqual(
        glyph(renderToStaticMarkup(<OfficialAppIcon appId="code" />)),
      );
    }
  });
});
