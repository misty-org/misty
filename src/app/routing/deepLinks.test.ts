import { describe, expect, it } from "vitest";

import { routeForMistyDeepLink } from "@/app/routing/deepLinks";
import {
  beginGoogleSignInCodeWait,
  deliveredGoogleSignInCode,
  endGoogleSignInCodeWait,
} from "@/features/auth/googleSignInCode";
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

  it("hands Google sign-in codes only to a sign-in that is waiting", () => {
    const route = (url: string) =>
      routeForMistyDeepLink(url, isDeepLinkRouteAllowed, resolveAuthDeepLinkRoute);
    expect(route("misty://auth/google/complete?code=ABCDEFGHJK")).toBeNull();
    expect(deliveredGoogleSignInCode()).toBe("");
    beginGoogleSignInCodeWait();
    expect(route("misty://auth/google/complete?code=abcde-0000")).toBeNull();
    expect(deliveredGoogleSignInCode()).toBe("");
    expect(route("misty://auth/google/complete?code=abcde-fghjk")).toBeNull();
    expect(deliveredGoogleSignInCode()).toBe("ABCDEFGHJK");
    endGoogleSignInCodeWait();
    expect(deliveredGoogleSignInCode()).toBe("");
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
