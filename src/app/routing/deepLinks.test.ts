import { describe, expect, it } from "vitest";

import { routeForMistyDeepLink } from "@/app/routing/deepLinks";
import { isDeepLinkRouteAllowed, resolveAuthDeepLinkRoute } from "@/app/routing/navigation";

describe("Misty deep links", () => {
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

  it("does not route retired device pairing links", () => {
    expect(
      routeForMistyDeepLink(
        "misty://devices/pair?session=pairing_abc&secret=SECRET",
        isDeepLinkRouteAllowed,
        resolveAuthDeepLinkRoute,
      ),
    ).toBeNull();
  });
});
