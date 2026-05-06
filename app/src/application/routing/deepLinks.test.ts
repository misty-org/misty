import { describe, expect, it } from "vitest";

import { routeForMistyDeepLink } from "@/application/routing/deepLinks";
import { isDeepLinkRouteAllowed, resolveAuthDeepLinkRoute } from "@/application/routing/navigation";

describe("Misty deep links", () => {
  it("preserves Assistant scope parameters for the legacy redirect", () => {
    expect(
      routeForMistyDeepLink(
        "misty://assistant?spaceId=space%2Fone&path=%2Fprivate",
        isDeepLinkRouteAllowed,
        resolveAuthDeepLinkRoute,
      ),
    ).toBe("/assistant?spaceId=space%2Fone&path=%2Fprivate");
  });

  it("preserves query state for open-form Space links", () => {
    expect(
      routeForMistyDeepLink(
        "misty://open/spaces/space-one/assistant?source=notification",
        isDeepLinkRouteAllowed,
        resolveAuthDeepLinkRoute,
      ),
    ).toBe("/spaces/space-one/assistant?source=notification");
  });

  it("opens invitation redemption links inside the desktop app", () => {
    expect(
      routeForMistyDeepLink(
        "misty://open/invite/token-123",
        isDeepLinkRouteAllowed,
        resolveAuthDeepLinkRoute,
      ),
    ).toBe("/invite/token-123");
  });
});
