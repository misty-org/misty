import { quotaPercentUsed } from "@/api/spaces/dto/interfaces/agentUsageTypes";
import { formatStorageBytes, useBillingUsage, useSpacesStore } from "@/features/spaces";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import type { SettingsContentProps } from "../settingsTypes";

export function AccountSection(_props: SettingsContentProps) {
  const billing = useBillingUsage(true);
  const fallbackStorage = useSpacesStore((state) => state.ownerStorage);
  const fallbackEntitlements = useSpacesStore((state) => state.limits);
  const ownedSpaces = useSpacesStore(
    (state) => state.spaces.filter((space) => space.role === "owner").length,
  );
  const entitlements = billing?.entitlements ?? fallbackEntitlements ?? undefined;
  const storage = billing?.personal?.storage ?? billing?.storage?.personal ?? fallbackStorage;
  const ai = billing?.personal?.ai;
  const legacyAi = billing?.agent_usage;
  const maxOwnedSpaces = entitlements?.max_owned_spaces ?? entitlements?.space_limit;
  const plan = billing?.plan ?? entitlements?.plan;
  const storageUsed = storage?.used_bytes;
  const storageLimit = storage?.limit_bytes;
  const aiPercent = ai ? quotaPercentUsed(ai) : legacyAi ? quotaPercentUsed(legacyAi) : undefined;
  const aiReset = ai?.reset_at ?? legacyAi?.reset_at;

  return (
    <SettingsSectionBlock
      title="Plan and usage"
      description="Your personal limits follow you across every Space you own or join."
    >
      <SettingsRow label="Plan" description="The plan attached to your Misty account.">
        <span className="text-sm capitalize text-cream-muted">{plan ?? "Unavailable"}</span>
      </SettingsRow>
      <SettingsRow
        label="Personal storage"
        description="Your total contribution across all Spaces."
      >
        <span className="text-sm text-cream-muted">
          {storageUsed !== undefined && storageLimit !== undefined
            ? `${formatStorageBytes(storageUsed)} of ${formatStorageBytes(storageLimit)} used`
            : "Usage unavailable"}
        </span>
      </SettingsRow>
      <SettingsRow
        label="Weekly hosted AI"
        description="Your personal weekly allowance across all Spaces."
      >
        <span className="text-sm text-cream-muted">
          {aiPercent !== undefined
            ? `${aiPercent.toFixed(0)}% used${
                aiReset ? ` · resets ${new Date(aiReset).toLocaleDateString()}` : ""
              }`
            : "Usage unavailable"}
        </span>
      </SettingsRow>
      <SettingsRow
        label="Owned Spaces"
        description="Joining other people’s Spaces does not count toward this limit."
        last
      >
        <span className="text-sm text-cream-muted">
          {maxOwnedSpaces !== undefined
            ? `${ownedSpaces} of ${maxOwnedSpaces} owned`
            : `${ownedSpaces} owned`}
        </span>
      </SettingsRow>
    </SettingsSectionBlock>
  );
}
