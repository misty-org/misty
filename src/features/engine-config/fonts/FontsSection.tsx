// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { Upload } from "lucide-react";
import { useEffect, useState } from "react";
import {
  DesktopSettingsNotice,
  DesktopSettingsRow as Row,
  DesktopSettingsSection as Section,
} from "@/features/settings";
import { Button, cn, Input, OverflowFadeText, Skeleton, SkeletonControl } from "@/shared/ui";
import { DropdownControl } from "../../settings/SettingsControls";
import {
  applyFontPreferences,
  CUSTOM_FONT_VALUE,
  ensureCustomFontLoaded,
  fontErrorMessage,
  fontRole,
  isValidFontFamily,
  loadFontPreferences,
  normalizeFontMode,
  pickFontFile,
  readCache,
  saveFontPreferences,
  type FontField,
  type FontPreferences,
} from "./font";

const fileField = (field: FontField) => (field === "fontFamily" ? "fontFile" : "codeFontFile");

/** Last part of a path, for the picker button. */
const fileName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

function FontFamilyRow({
  label,
  description,
  value,
  filePath,
  busy,
  onModeChange,
  onPickFile,
}: {
  label: string;
  description: string;
  value: string;
  filePath: string;
  busy: boolean;
  onModeChange: (value: string) => Promise<boolean>;
  onPickFile: () => Promise<boolean>;
}) {
  const normalized = normalizeFontMode(value);
  const uploaded = normalized === CUSTOM_FONT_VALUE;
  const savedText = uploaded ? "" : normalized;
  const savedMode = uploaded ? "custom" : normalized ? "family" : "default";
  const [pendingMode, setPendingMode] = useState<"custom" | "family" | null>(null);
  const [text, setText] = useState(savedText);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(savedText);
    setInvalid(false);
    setPendingMode(null);
  }, [savedText, uploaded]);
  const mode = pendingMode ?? savedMode;

  const commit = async () => {
    if (mode !== "family" || text.trim() === savedText) return;
    const next = text.trim();
    if (next === CUSTOM_FONT_VALUE || next === "system" || !isValidFontFamily(next)) {
      setInvalid(true);
      return;
    }
    const saved = await onModeChange(next);
    if (!saved) setText(savedText);
    else setPendingMode(null);
  };

  const choose = (key: string) => {
    setInvalid(false);
    if (key === "family") {
      setPendingMode("family");
    } else if (key === "custom") {
      setPendingMode("custom");
      if (filePath && !uploaded) {
        void onModeChange(CUSTOM_FONT_VALUE).then((saved) => {
          // A failed save goes back to the option in effect, as the default does.
          if (!saved) setPendingMode(null);
        });
      }
    } else {
      setPendingMode(null);
      setText("");
      void onModeChange("");
    }
  };

  return (
    <>
      <Row label={label} description={description}>
        <DropdownControl
          value={mode}
          disabled={busy}
          options={[
            { value: "default", label: "Misty's font" },
            { value: "custom", label: "Font file" },
            { value: "family", label: "Installed font" },
          ]}
          onValueChange={choose}
        />
      </Row>
      {mode === "family" ? (
        <Row
          label={`${label} family`}
          description={
            invalid
              ? "Write a font name or a list of them, without font-family:, declarations or variables."
              : "A name like “Maple Mono”, or a list ending in a generic family."
          }
          indent
        >
          <Input
            aria-label={`${label} family`}
            className="w-64"
            value={text}
            placeholder={'"Maple Mono", monospace'}
            aria-invalid={invalid || undefined}
            disabled={busy}
            onChange={(event) => {
              setText(event.target.value);
              setInvalid(false);
            }}
            onBlur={() => void commit()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                setText(savedText);
                setInvalid(false);
              }
            }}
          />
        </Row>
      ) : null}
      {mode === "custom" ? (
        <Row label={`${label} file`} description="TTF, OTF, TTC, WOFF or WOFF2." indent>
          <Button disabled={busy} onClick={() => void onPickFile()}>
            <Upload />
            <OverflowFadeText full={filePath || undefined} className="block max-w-56">
              {filePath ? fileName(filePath) : "Choose font file"}
            </OverflowFadeText>
          </Button>
        </Row>
      ) : null}
    </>
  );
}

/**
 * Settings › Interface › Fonts: the interface font and the code font (chat code, the editor, diffs
 * and the terminal). Kept on this computer; a picked file is copied into Misty's own folder.
 */
export function FontsSection() {
  // The copy applied at launch paints the rows at once; the saved settings replace it when read.
  const [settings, setSettings] = useState<FontPreferences | null>(readCache);
  const [busy, setBusy] = useState<FontField | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadFontPreferences()
      .then((loaded) => !cancelled && setSettings(loaded))
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(fontErrorMessage(cause));
        setSettings(
          (shown) =>
            shown ?? { fontFamily: "", codeFontFamily: "", fontFile: "", codeFontFile: "" },
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (next: FontPreferences): Promise<boolean> => {
    try {
      const saved = await saveFontPreferences(next);
      setSettings(saved);
      applyFontPreferences(saved);
      return true;
    } catch (cause) {
      setError(fontErrorMessage(cause));
      return false;
    }
  };

  /** Every family change goes through here; a failed save leaves the applied font as it was. */
  const onModeChange = async (field: FontField, value: string): Promise<boolean> => {
    if (!settings || busy) return false;
    const normalized = normalizeFontMode(value);
    setBusy(field);
    setError(null);
    try {
      const next = { ...settings, [field]: normalized };
      const path = next[fileField(field)];
      if (normalized === CUSTOM_FONT_VALUE && path) {
        // Load first, so a broken file never becomes the saved font.
        await ensureCustomFontLoaded(fontRole(field), path, { force: true });
      }
      return await save(next);
    } catch (cause) {
      setError(fontErrorMessage(cause));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const onPickFile = async (field: FontField): Promise<boolean> => {
    if (!settings || busy) return false;
    setBusy(field);
    setError(null);
    try {
      const path = await pickFontFile(fontRole(field));
      if (!path) return false;
      await ensureCustomFontLoaded(fontRole(field), path, { force: true });
      return await save({ ...settings, [field]: CUSTOM_FONT_VALUE, [fileField(field)]: path });
    } catch (cause) {
      setError(fontErrorMessage(cause));
      return false;
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {error ? <DesktopSettingsNotice>{error}</DesktopSettingsNotice> : null}
      <Section title="Fonts">
        {settings ? (
          <>
            <FontFamilyRow
              label="Interface font"
              description="Menus, chats and pages."
              value={settings.fontFamily}
              filePath={settings.fontFile}
              busy={busy !== null}
              onModeChange={(mode) => onModeChange("fontFamily", mode)}
              onPickFile={() => onPickFile("fontFamily")}
            />
            <FontFamilyRow
              label="Code font"
              description="Code in chats, the editor, diffs and the terminal."
              value={settings.codeFontFamily}
              filePath={settings.codeFontFile}
              busy={busy !== null}
              onModeChange={(mode) => onModeChange("codeFontFamily", mode)}
              onPickFile={() => onPickFile("codeFontFamily")}
            />
          </>
        ) : (
          // Only before fonts were ever applied on this computer: the two rows, each with its
          // description and its menu.
          ["w-32", "w-28"].map((width, index) => (
            <div
              key={width}
              data-setting-label=""
              role={index === 0 ? "status" : undefined}
              aria-label={index === 0 ? "Fonts" : undefined}
              aria-busy={index === 0 || undefined}
              className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-8 py-3"
            >
              <div className="grid min-w-0 gap-1">
                <div className="flex h-6 items-center">
                  <Skeleton className={cn("h-4", width)} />
                </div>
                <div className="flex h-6 items-center">
                  <Skeleton className="h-3.5 w-2/3" />
                </div>
              </div>
              <SkeletonControl kind="select" className="w-50" />
            </div>
          ))
        )}
      </Section>
    </>
  );
}
