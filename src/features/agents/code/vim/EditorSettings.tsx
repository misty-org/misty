import { useEffect } from "react";
import { DesktopSettingsRow as Row, DesktopSettingsSection as Section } from "@/features/settings";
import { editorFonts, editorThemes } from "@/shared/lib/codemirror/editorThemes";
import { Button, OptionSelect, Switch } from "@misty/ui";
import { useEditorFont, useEditorTheme } from "../editorAppearance";
import { useEditorNvimMappings, useEditorVim, useEditorWordWrap } from "./editorVimSettings";
import { useNvimConfig, type NvimConfig } from "./nvimConfig";
import { runnable } from "./vimAddon";

/** What was read from the person's Neovim config, in one line for its settings row. */
function configLine(config: NvimConfig | null, error: string | null): string {
  if (error) return error;
  if (!config) return "Your mappings and options, without plugins.";
  if (config.source === "none") return "No Neovim config was found.";
  const taken = config.mappings.filter((mapping) => runnable(mapping.rhs)).length;
  const how = config.source === "nvim" ? "read with Neovim" : "read from your config files";
  const left = config.mappings.length - taken + config.skipped;
  return `${taken} ${taken === 1 ? "mapping" : "mappings"} ${how}${
    left ? `, ${left} that need plugins or Lua left out` : ""
  }.`;
}

/**
 * Settings › Code › Editor: the Code page editor's theme and font, vim keys in the code
 * editor, and whether they follow the person's own Neovim mappings and options.
 */
export function EditorSettings() {
  const theme = useEditorTheme((state) => state.value);
  const font = useEditorFont((state) => state.value);
  const vimOn = useEditorVim((state) => state.value);
  const ownOn = useEditorNvimMappings((state) => state.value);
  const wrapOn = useEditorWordWrap((state) => state.value);
  const { config, reading, error } = useNvimConfig();
  useEffect(() => {
    if (vimOn && ownOn) void useNvimConfig.getState().read();
  }, [vimOn, ownOn]);

  return (
    <Section
      title="Editor"
      description="How the code editor on the Code page and beside chats works."
    >
      <Row label="Theme" description="The code's colors on the Code page.">
        <OptionSelect
          aria-label="Theme"
          className="w-50 max-w-full"
          value={theme}
          options={editorThemes}
          onValueChange={(next) => useEditorTheme.getState().set(next)}
        />
      </Row>
      <Row label="Font" description="The code's typeface on the Code page.">
        <OptionSelect
          aria-label="Font"
          className="w-50 max-w-full"
          value={font}
          options={editorFonts}
          onValueChange={(next) => useEditorFont.getState().set(next)}
        />
      </Row>
      <Row label="Word wrap">
        <Switch
          aria-label="Word wrap"
          checked={wrapOn}
          onCheckedChange={(next) => useEditorWordWrap.getState().set(next)}
        />
      </Row>
      <Row label="Vim keybindings" description="Vim's modes and keys in the code editor.">
        <Switch
          aria-label="Vim keybindings"
          checked={vimOn}
          onCheckedChange={(next) => useEditorVim.getState().set(next)}
        />
      </Row>
      {vimOn ? (
        <Row
          label="Use my Neovim mappings"
          description={configLine(ownOn ? config : null, ownOn ? error : null)}
          indent
        >
          <div className="flex items-center gap-2">
            {ownOn ? (
              <Button
                variant="quiet"
                disabled={reading}
                onClick={() => void useNvimConfig.getState().read(true)}
              >
                Read again
              </Button>
            ) : null}
            <Switch
              aria-label="Use my Neovim mappings"
              checked={ownOn}
              onCheckedChange={(next) => useEditorNvimMappings.getState().set(next)}
            />
          </div>
        </Row>
      ) : null}
    </Section>
  );
}
