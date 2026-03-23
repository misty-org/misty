import { useSetupStore } from "../../store/useSetupStore";
import WebsiteSignIn from "../../website/pages/SignIn";
import type { CurrentLicense } from "../../types/setup";
import type { MeResponse } from "../../website/pages/Dashboard/api";

function licenseFromMe(me: MeResponse | null): CurrentLicense | null {
  if (!me) {
    return null;
  }
  return {
    tier: me.tier,
    status: me.status,
    allows_use: me.allows_use,
    expires_at: me.expires_at,
    trial_started_at: me.trial_started_at,
    license_device: me.license_device || null,
  };
}

export default function SignIn() {
  const saveAuthenticatedUser = useSetupStore((state) => state.saveAuthenticatedUser);

  return (
    <WebsiteSignIn
      onSignedIn={(user, context) =>
        saveAuthenticatedUser(user, licenseFromMe(context.me))}
    />
  );
}
