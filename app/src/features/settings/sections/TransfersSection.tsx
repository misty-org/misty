import { useOperationQueueStore } from "@/features/files/explorer";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { transferBehaviorOptions } from "../settingsConstants";
import {
  NumberControl,
  numberSetting,
  SelectControl,
  SwitchControl,
  TextControl,
} from "../settingsControls";
import {
  defaultTransferProfileId,
  transferProfileDocument,
  transferProfileRecords,
  type TransferProfileRecord,
} from "../transferProfiles";
import type { SettingsContentProps } from "../settingsTypes";

export function TransfersSection(props: SettingsContentProps) {
  return (
    <>
      <SettingsSectionBlock title="Defaults">
        <SettingsRow
          label="Default transfer behavior"
          description="Choose how copy and download flows should behave by default."
          last
        >
          <SelectControl
            value={numberSetting(props.document, "general", "default_transfer_behavior_index", 0)}
            options={transferBehaviorOptions}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("general", "default_transfer_behavior_index", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <TransferProfileSettings {...props} />
    </>
  );
}

/**
 * The Rust queue reads the selected profile for its concurrency and bandwidth
 * limit, so both the choice of profile and the values inside it are live.
 */
function TransferProfileSettings(props: SettingsContentProps) {
  const profiles = transferProfileRecords(props.document);
  const defaultProfileId = defaultTransferProfileId(props.document);
  const selectedIndex = Math.max(
    0,
    profiles.findIndex((profile) => profile.id === defaultProfileId),
  );
  const setTransferProfile = useOperationQueueStore((state) => state.setTransferProfile);

  if (profiles.length === 0) return null;
  const active = profiles[selectedIndex];
  if (!active) return null;

  const applyProfile = (patch: Partial<TransferProfileRecord>) => {
    const next = { ...active, ...patch };
    props.onSettingChange(
      "transfer_profiles",
      "profiles",
      profiles.map((profile) => transferProfileDocument(profile.id === active.id ? next : profile)),
    );
    void setTransferProfile(next);
  };

  return (
    <>
      <SettingsSectionBlock title="Performance">
        <SettingsRow
          label="Profile"
          description="How many files move at once, and whether transfers are bandwidth-limited or checksum-verified."
          last
        >
          <SelectControl
            value={selectedIndex}
            options={profiles.map((profile) => profile.name)}
            disabled={props.working}
            onChange={(value) => {
              const profile = profiles[value];
              if (!profile) return;
              props.onSettingChange("transfer_profiles", "default_profile_id", profile.id);
              void setTransferProfile(profile);
            }}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock
        title={`${active.name} profile`}
        description="Tune the selected profile. Changes apply to new transfers."
      >
        <SettingsRow label="Parallel transfers" description="Files copied at the same time.">
          <NumberControl
            value={active.transfers}
            min={1}
            max={64}
            disabled={props.working}
            onCommit={(value) => applyProfile({ transfers: value })}
          />
        </SettingsRow>
        <SettingsRow
          label="Checkers"
          description="Parallel workers comparing source and destination."
        >
          <NumberControl
            value={active.checkers}
            min={1}
            max={128}
            disabled={props.working}
            onCommit={(value) => applyProfile({ checkers: value })}
          />
        </SettingsRow>
        <SettingsRow
          label="Bandwidth limit"
          description="For example 2Mi or 500Ki. Leave empty for no limit."
        >
          <TextControl
            value={active.bandwidthLimit}
            placeholder="No limit"
            disabled={props.working}
            onCommit={(value) => applyProfile({ bandwidthLimit: value.trim() })}
          />
        </SettingsRow>
        <SettingsRow label="Retries" description="How many times a failed file is attempted again.">
          <NumberControl
            value={active.retries}
            min={0}
            max={20}
            disabled={props.working}
            onCommit={(value) => applyProfile({ retries: value })}
          />
        </SettingsRow>
        <SettingsRow
          label="Verify with checksum"
          description="Slower, but confirms every transferred file byte for byte."
          last
        >
          <SwitchControl
            checked={active.checksum}
            disabled={props.working}
            onChange={(value) => applyProfile({ checksum: value })}
          />
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}
