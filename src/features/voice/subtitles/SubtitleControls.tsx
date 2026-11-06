import { Volume2, VolumeX } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { IconButton, Input, OptionSelect, Slider, Textarea } from "@/shared/ui";
import {
  formatTranslationTerms,
  parseTerms,
  parseTranslationTerms,
  subtitleCategories,
} from "./subtitleContext";
import { subtitleLanguages, subtitleSources } from "./subtitleLanguages";
import type { ControlGroup } from "./SubtitleToolbar";
import type { SubtitlePrefs, SubtitlesAction, SubtitlesView } from "./subtitlesView";

function Field(props: { label: string; children: ReactNode }) {
  return (
    <div className="subtitle-field">
      <span>{props.label}</span>
      {props.children}
    </div>
  );
}

function VolumeRow(props: {
  label: string;
  gain: number;
  muted: boolean;
  onGain: (gain: number) => void;
  onMuted: (muted: boolean) => void;
}) {
  return (
    <div className="subtitle-volume">
      <Field label={props.label}>
        <Slider
          aria-label={props.label}
          min={0}
          max={1}
          step={0.05}
          value={[props.gain]}
          onValueChange={([gain]) => props.onGain(gain)}
        />
      </Field>
      <IconButton
        label={props.muted ? `Unmute ${props.label.toLowerCase()}` : `Mute ${props.label.toLowerCase()}`}
        aria-pressed={props.muted}
        onClick={() => props.onMuted(!props.muted)}
      >
        {props.muted ? <VolumeX size={16} aria-hidden /> : <Volume2 size={16} aria-hidden />}
      </IconButton>
    </div>
  );
}

/**
 * One toolbar card. What shapes a session is locked while it runs; volume never is. Text fields
 * keep their own value, because every change makes a round trip through the opening window.
 */
export function SubtitleControls(props: {
  group: ControlGroup;
  view: SubtitlesView;
  act: (action: SubtitlesAction) => void;
}) {
  const { group, view, act } = props;
  const { prefs } = view;
  const active = view.status !== "idle";
  const set = (patch: Partial<SubtitlePrefs>) => act({ type: "prefs", patch });
  const setContext = (patch: Partial<SubtitlePrefs["context"]>) =>
    set({ context: { ...prefs.context, ...patch } });
  useEffect(() => {
    if (group === "input") act({ type: "refreshApps" });
  }, [group, act]);
  if (group === "input") {
    const apps = [...view.apps, ...(prefs.app && !view.apps.includes(prefs.app) ? [prefs.app] : [])];
    return (
      <div className="subtitle-fields">
        <Field label="Input source">
          <OptionSelect
            aria-label="Input source"
            value={prefs.input}
            disabled={active}
            options={[
              { value: "mic", label: "Microphone" },
              { value: "system", label: "Desktop audio" },
            ]}
            onValueChange={(input) => set({ input: input as SubtitlePrefs["input"] })}
          />
        </Field>
        {prefs.input === "system" && (
          <Field label="Playback source">
            <OptionSelect
              aria-label="Playback source"
              value={prefs.app}
              disabled={active}
              options={[
                { value: "", label: "All desktop audio" },
                ...apps.map((app) => ({ value: app, label: app })),
              ]}
              onValueChange={(app) => set({ app })}
            />
          </Field>
        )}
      </div>
    );
  }
  if (group === "languages") {
    return (
      <div className="subtitle-fields">
        <Field label="Caption mode">
          <OptionSelect
            aria-label="Caption mode"
            value={prefs.mode}
            disabled={active}
            options={[
              { value: "subtitles", label: "Captions" },
              { value: "translate", label: "Translation" },
            ]}
            onValueChange={(mode) => set({ mode: mode as SubtitlePrefs["mode"] })}
          />
        </Field>
        <Field label="Source language">
          <OptionSelect
            aria-label="Source language"
            value={prefs.source}
            disabled={active}
            options={subtitleSources}
            onValueChange={(source) => set({ source })}
          />
        </Field>
        {prefs.mode === "translate" && (
          <Field label="Target language">
            <OptionSelect
              aria-label="Target language"
              value={prefs.target}
              disabled={active}
              options={subtitleLanguages.map((option) => ({
                ...option,
                disabled: option.value === prefs.source,
              }))}
              onValueChange={(target) => set({ target })}
            />
          </Field>
        )}
      </div>
    );
  }
  if (group === "context") {
    const { context } = prefs;
    return (
      <div className="subtitle-fields">
        <Field label="Category">
          <OptionSelect
            aria-label="Context category"
            value={context.category}
            disabled={active}
            options={subtitleCategories}
            onValueChange={(category) => setContext({ category })}
          />
        </Field>
        {context.category === "custom" && (
          <Field label="Custom category">
            <Input
              aria-label="Custom category"
              disabled={active}
              maxLength={160}
              defaultValue={context.customCategory}
              onChange={(event) => setContext({ customCategory: event.target.value })}
            />
          </Field>
        )}
        <Field label="Additional context">
          <Textarea
            aria-label="Additional context"
            disabled={active}
            maxLength={10_000}
            defaultValue={context.text}
            onChange={(event) => setContext({ text: event.target.value })}
          />
        </Field>
        <Field label="Names and terms">
          <Textarea
            aria-label="Names and terms"
            disabled={active}
            defaultValue={context.terms.join("\n")}
            onChange={(event) => setContext({ terms: parseTerms(event.target.value) })}
          />
        </Field>
        <Field label="Preferred translations">
          <Textarea
            aria-label="Preferred translations"
            disabled={active}
            defaultValue={formatTranslationTerms(context.translationTerms)}
            onChange={(event) =>
              setContext({ translationTerms: parseTranslationTerms(event.target.value) })
            }
          />
        </Field>
      </div>
    );
  }
  if (group === "audio") {
    return (
      <div className="subtitle-fields">
        {prefs.input === "mic" ? (
          <VolumeRow
            label="Microphone input"
            gain={prefs.micGain}
            muted={prefs.micMuted}
            onGain={(micGain) => set({ micGain })}
            onMuted={(micMuted) => set({ micMuted })}
          />
        ) : (
          <VolumeRow
            label="Desktop audio input"
            gain={prefs.desktopGain}
            muted={prefs.desktopMuted}
            onGain={(desktopGain) => set({ desktopGain })}
            onMuted={(desktopMuted) => set({ desktopMuted })}
          />
        )}
      </div>
    );
  }
  return (
    <div className="subtitle-fields">
      <Field label={`Stop after silence · ${prefs.silenceSeconds}s`}>
        <Slider
          aria-label="Silence timeout"
          min={10}
          max={300}
          step={5}
          disabled={active}
          value={[prefs.silenceSeconds]}
          onValueChange={([silenceSeconds]) => set({ silenceSeconds })}
        />
      </Field>
      <Field label={`Silence level · ${prefs.silenceDbfs} dBFS`}>
        <Slider
          aria-label="Silence level"
          min={-80}
          max={-30}
          step={1}
          disabled={active}
          value={[prefs.silenceDbfs]}
          onValueChange={([silenceDbfs]) => set({ silenceDbfs })}
        />
      </Field>
    </div>
  );
}
