import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandIcon } from "../../../../misty-apps/apps/shared/BrandIcon";
import { brandIconAsset, brandIcons } from "../../../../misty-apps/apps/shared/brandIcons";
import { providers } from "../../../../misty-apps/apps/shared/providers";
import { ProviderBrandIcon } from "../../../../misty-apps/apps/shared/ProviderBrandIcon";
import { websiteIntegrations } from "../../../../misty-apps/apps/shared/websiteIntegrations";
import { DestinationIcon } from "@/application/layouts/DesktopLayout/DownloadedAppNavigator";
import { WorkspaceTabGroupButton } from "@/application/layouts/DesktopLayout/WorkspaceTabGroupButton";
import { MarketplaceCatalogIcon } from "@/features/marketplace/components/MarketplaceCatalogIcon";
import { OfficialAppIcon } from "./OfficialAppIcon";
import type { NavigatorAppId, WorkspaceTab } from "@/features/workspace";

function imageSource(markup: string) {
  const container = document.createElement("div");
  container.innerHTML = markup;
  const adaptiveX = container.querySelector<HTMLElement>('span[data-brand-icon="x"]');
  if (adaptiveX) {
    const source = brandIconAsset("x")!.src;
    expect(adaptiveX.style.mask).toContain(source);
    expect(adaptiveX.style.backgroundColor).toBe("light-dark(rgb(0, 0, 0), rgb(255, 255, 255))");
    return source;
  }
  const image = container.querySelector<HTMLImageElement>("img[data-brand-icon]");
  expect(image).not.toBeNull();
  expect(markup).not.toMatch(/grayscale|mask:/);
  return image!.getAttribute("src");
}

describe("integration brand artwork", () => {
  it.each(Object.entries(providers))(
    "uses one SVG for %s in directory, navigation, and Discover",
    (id, provider) => {
      const appId = provider.family === "chat" ? "social" : provider.family;
      const route = `/apps/${appId}?provider=${id}`;
      const expected = brandIconAsset(id)!.src;
      const tab: WorkspaceTab = {
        id: `tab-${id}`,
        surfaceId: "official-app",
        groupKey: `app:${appId}`,
        instanceKey: appId,
        route,
        title: provider.label,
        sidebarVisible: true,
        state: {},
        createdAt: 1,
        lastFocusedAt: 1,
      };
      const surfaces = [
        <ProviderBrandIcon provider={id as keyof typeof providers} />,
        <DestinationIcon
          appId={appId as NavigatorAppId}
          item={{ id, route, label: provider.label }}
        />,
        <OfficialAppIcon appId={id} />,
        <MarketplaceCatalogIcon pluginId={id} />,
      ];
      for (const surface of surfaces)
        expect(imageSource(renderToStaticMarkup(surface))).toBe(expected);
      const groupMarkup = renderToStaticMarkup(
        <WorkspaceTabGroupButton
          group={{
            key: tab.groupKey,
            surfaceId: tab.surfaceId,
            label: tab.title,
            tabs: [tab],
            storeGroupKey: tab.groupKey,
          }}
          activeTabId={null}
          canClose={false}
          lastUsedTabByGroup={{}}
          onOpen={() => {}}
          onClose={() => {}}
          onMoveTab={() => {}}
        />,
      );
      expect(groupMarkup).not.toContain("data-brand-icon");
      expect(groupMarkup).toContain('width="14"');
      const pin = renderToStaticMarkup(
        <DestinationIcon
          appId={appId as NavigatorAppId}
          item={{ id: `pin-${id}`, route: `${route}&pin=example`, label: provider.label }}
        />,
      );
      expect(pin).toContain("lucide-link");
      expect(pin).not.toContain("<img");
    },
  );

  it("covers every website integration and retains familiar provider aliases", () => {
    for (const id of Object.keys(websiteIntegrations)) expect(brandIconAsset(id)).toBeDefined();
    expect(brandIconAsset("google")?.src).toBe(brandIconAsset("gmail")?.src);
    expect(brandIconAsset("microsoft")?.src).toBe(brandIconAsset("outlook-calendar")?.src);
    expect(brandIconAsset("drive")?.src).toBe(brandIconAsset("google-drive")?.src);
    for (const id of ["constructor", "__proto__", "unknown"])
      expect(brandIconAsset(id)).toBeUndefined();
  });

  it.each(Object.keys(brandIcons))("ships %s as self-contained vector artwork", (id) => {
    const source = readFileSync(
      resolve(process.cwd(), `../misty-apps/apps/shared/brand-icons/${id}.svg`),
      "utf8",
    );
    const svg = new DOMParser().parseFromString(source, "image/svg+xml");
    expect(svg.querySelector("parsererror")).toBeNull();
    expect(svg.documentElement.localName).toBe("svg");
    expect(svg.documentElement.getAttribute("viewBox")).toBeTruthy();
    expect(svg.querySelector("image, script, foreignObject")).toBeNull();
    expect(source).not.toMatch(/(?:href|url\()\s*=?["']?https?:/);
    expect(imageSource(renderToStaticMarkup(<BrandIcon brand={id} size={14} />))).toBe(
      brandIconAsset(id)!.src,
    );
  });
});
