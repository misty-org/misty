import { Button } from "@/shared/ui";
import { Trash2 } from "lucide-react";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import {
  defaultFileActionOptions,
  fileViewModeOptions,
  settingsAssociationRowClass,
  settingsEmptyClass,
  settingsIconDangerClass,
  settingsReferenceHeaderClass,
  settingsReferenceListClass,
  settingsReferenceSpanClass,
} from "../settingsConstants";
import {
  booleanSetting,
  numberSetting,
  SelectControl,
  SettingsNote,
  stringSetting,
  SwitchControl,
  TextControl,
  WorkspaceRootControl,
} from "../settingsControls";
import type { SettingsContentProps } from "../settingsTypes";

export function FilesSection(props: SettingsContentProps) {
  return (
    <>
      <SettingsSectionBlock title="Locations">
        <SettingsRow
          label="Starting folder"
          description="Choose the default starting location for file browsing."
        >
          <WorkspaceRootControl
            value={stringSetting(props.document, "general", "preferred_workspace_root", "")}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("general", "preferred_workspace_root", value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Mount path"
          description="The root path Misty should treat as its default mount target."
          last
        >
          <TextControl
            value={stringSetting(props.document, "advanced", "mount_path", ".misty/mnt")}
            disabled={props.working}
            onCommit={(value) => props.onSettingChange("advanced", "mount_path", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Defaults">
        <SettingsRow
          label="View mode"
          description="How a folder is laid out when you first open it."
        >
          <SelectControl
            value={numberSetting(props.document, "files", "default_view_mode_index", 0)}
            options={fileViewModeOptions}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("files", "default_view_mode_index", value)}
          />
        </SettingsRow>
        <SettingsRow
          label="Default file action"
          description="What a primary file interaction does."
        >
          <SelectControl
            value={numberSetting(props.document, "general", "default_file_action_index", 0)}
            options={defaultFileActionOptions}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("general", "default_file_action_index", value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Show hidden files"
          description="Include dotfiles and system files in folder listings."
          last
        >
          <SwitchControl
            checked={booleanSetting(props.document, "files", "show_hidden_files", false)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("files", "show_hidden_files", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Open with associations">
        <SettingsNote>Review remembered apps used by File Explorer.</SettingsNote>
        <div className={settingsReferenceListClass}>
          <div className={`${settingsAssociationRowClass} ${settingsReferenceHeaderClass}`}>
            <span>File</span>
            <span>Application</span>
            <span />
          </div>
          {props.openWithAssociations.map((association) => (
            <div className={settingsAssociationRowClass} key={association.key}>
              <span className={settingsReferenceSpanClass}>{association.key}</span>
              <span
                className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
                title={association.applicationPath}
              >
                {association.applicationPath}
              </span>
              <Button
                variant="outline"
                size="icon"
                type="button"
                className={settingsIconDangerClass}
                aria-label={`Remove ${association.key}`}
                disabled={props.working}
                onClick={() => void props.onRemoveOpenWithAssociation(association.key)}
              >
                <Trash2 size={15} />
              </Button>
            </div>
          ))}
          {props.openWithAssociations.length === 0 ? (
            <p className={settingsEmptyClass}>No Open With associations saved.</p>
          ) : null}
        </div>
      </SettingsSectionBlock>
    </>
  );
}
