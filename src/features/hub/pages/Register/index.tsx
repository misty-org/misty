import { useSetupStore } from "../../store/useSetupStore";
import type { CurrentLicense } from "../../types/setup";
import WebsiteRegister from "../../website/pages/Register";
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

export default function Register() {
  const saveAuthenticatedUser = useSetupStore((state) => state.saveAuthenticatedUser);

  return (
    <WebsiteRegister
      onRegistered={(user, context) =>
        saveAuthenticatedUser(user, licenseFromMe(context.me))}
    />
  );
}
