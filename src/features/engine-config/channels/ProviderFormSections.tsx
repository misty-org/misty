// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { ChevronDown, Cloud, Globe } from "lucide-react";
import { useState, type ReactNode } from "react";
import { EngineMark, hasEngineMark } from "../EngineMark";
import { Button, cn, Input, Textarea, Pressable } from "@/shared/ui";
import { BrandMark } from "../brands/BrandMark";
import type { EngineId } from "./engines";
import {
  CLAUDE_MODEL_SLOTS,
  isOfficialAnthropicEndpoint,
  type ClaudeModelSlot,
  type ProviderPreset,
} from "./providerPresets";
import type { ProviderForm } from "./useProviderForm";

const FETCH_DATALIST_ID = "engine-channel-fetched-models";

const slotLabels: Record<ClaudeModelSlot, { label: string; placeholder: string }> = {
  fable: { label: "Fable default model", placeholder: "e.g. claude-fable-5" },
  sonnet: { label: "Sonnet default model", placeholder: "e.g. claude-sonnet-4-5" },
  opus: { label: "Opus default model", placeholder: "e.g. claude-opus-4-5" },
  haiku: { label: "Haiku default model", placeholder: "e.g. claude-haiku-4-5" },
};

const sectionLabel = "text-sm font-medium text-cream-muted";
const choice = (selected: boolean) =>
  cn(
    "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition-colors",
    selected
      ? "border-cream/30 bg-charcoal-hover text-cream-bright"
      : "border-charcoal-border text-cream-muted hover:bg-charcoal-hover hover:text-cream",
  );

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1.5">
      <span className="text-sm text-cream-muted">{label}</span>
      {children}
    </label>
  );
}

/** A preset's own mark (never inferred from its default model, which for a relay can be another
 *  brand's), or a neutral monogram when it has no public one. */
function PresetMark({ preset }: { preset: ProviderPreset }) {
  if (preset.mark) return <BrandMark mark={preset.mark} size={16} />;
  return (
    <span className="flex size-4 shrink-0 items-center justify-center rounded bg-cream/10 text-3xs font-semibold text-cream">
      {preset.name.charAt(0).toUpperCase()}
    </span>
  );
}

/** The official endpoint card (Claude Code and Codex): it pins the channel to the vendor. */
function OfficialPresetSection({
  engine,
  official,
  onSelect,
}: {
  engine: EngineId;
  official: boolean;
  onSelect: () => void;
}) {
  const isClaude = engine === "claude";
  return (
    <div className="grid gap-2">
      <p className={sectionLabel}>Official API</p>
      <Pressable
        aria-pressed={official}
        onClick={onSelect}
        className={cn(choice(official), "w-full gap-3 p-3")}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-charcoal-card">
          {hasEngineMark(engine) ? (
            <EngineMark engine={engine} size={16} />
          ) : (
            <Globe className="size-4" />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-cream-bright">
            {isClaude ? "Anthropic official API" : "OpenAI official API"}
          </span>
          <span className="text-xs text-cream-muted">
            {isClaude
              ? "Your own key, straight to https://api.anthropic.com."
              : "Your own OPENAI_API_KEY, straight to https://api.openai.com/v1."}
          </span>
        </span>
      </Pressable>
    </div>
  );
}

/** Third-party presets, with Custom, which unlocks the URL without filling anything in. */
function RelayPresetSection({
  presets,
  official,
  matchedPreset,
  onSelectCustom,
  onSelectPreset,
}: {
  presets: ProviderPreset[];
  official: boolean;
  matchedPreset: ProviderPreset | undefined;
  onSelectCustom: () => void;
  onSelectPreset: (preset: ProviderPreset) => void;
}) {
  return (
    <div className="grid gap-2">
      <p className={sectionLabel}>Third-party providers</p>
      <div className="grid grid-cols-3 gap-2">
        <Pressable
          aria-pressed={!official && !matchedPreset}
          onClick={onSelectCustom}
          className={choice(!official && !matchedPreset)}
        >
          <Globe className="size-4 shrink-0" aria-hidden />
          <span className="truncate">Custom</span>
        </Pressable>
        {presets.map((preset) => (
          <Pressable
            key={preset.name}
            aria-pressed={matchedPreset?.name === preset.name}
            onClick={() => onSelectPreset(preset)}
            className={choice(matchedPreset?.name === preset.name)}
          >
            <PresetMark preset={preset} />
            <span className="truncate">{preset.name}</span>
          </Pressable>
        ))}
      </div>
    </div>
  );
}

/** Fetch models, with what came back or why not; the ids feed the model fields' suggestions. */
function FetchModelsControl({
  fetching,
  error,
  count,
  disabled,
  onFetch,
}: {
  fetching: boolean;
  error: string;
  count: number;
  disabled: boolean;
  onFetch: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Button
        type="button"
        size="xs"
        variant="outline"
        onClick={onFetch}
        disabled={fetching || disabled}
      >
        {fetching ? "Fetching models" : "Fetch models"}
      </Button>
      {error ? (
        <span className="truncate text-xs text-cream-muted" role="alert">
          {error}
        </span>
      ) : count > 0 ? (
        <span className="text-xs text-cream-muted">
          {count === 1 ? "1 model" : `${count} models`}
        </span>
      ) : null}
    </div>
  );
}

function FetchedModels({ models }: { models: string[] }) {
  return (
    <datalist id={FETCH_DATALIST_ID}>
      {models.map((model) => (
        <option key={model} value={model} />
      ))}
    </datalist>
  );
}

/** The official card (Claude Code and Codex) and the third-party presets. */
export function ProviderPresetSections({ engine, form }: { engine: EngineId; form: ProviderForm }) {
  const isClaude = engine === "claude";
  const isCodex = engine === "codex";
  return (
    <>
      {isClaude || isCodex ? (
        <OfficialPresetSection
          engine={engine}
          official={form.official}
          onSelect={form.selectOfficial}
        />
      ) : null}
      {form.presets.length > 0 ? (
        <RelayPresetSection
          presets={form.presets}
          official={form.official}
          matchedPreset={form.matchedPreset}
          onSelectCustom={form.selectCustom}
          onSelectPreset={form.selectPreset}
        />
      ) : null}
    </>
  );
}

/** Name and note, and the URL and key (not for Codex, which edits config.toml instead). Claude
 *  Code's fields mirror every keystroke into the JSON editor's env. */
export function ProviderBasicFields({
  engine,
  form,
  hasKey,
}: {
  engine: EngineId;
  form: ProviderForm;
  /** A key is saved for this channel; an empty field keeps it. */
  hasKey: boolean;
}) {
  const isClaude = engine === "claude";
  const isCodex = engine === "codex";
  const { value, patch } = form;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Labelled label="Name">
        <Input
          required
          placeholder="My relay"
          value={value.name}
          onChange={(event) => patch({ name: event.target.value })}
          autoFocus
        />
      </Labelled>
      <Labelled label="Note">
        <Input
          placeholder="About this provider"
          value={value.remark}
          onChange={(event) => patch({ remark: event.target.value })}
        />
      </Labelled>
      {!isCodex ? (
        <Labelled label="API URL">
          <Input
            required
            placeholder="https://…"
            value={value.baseUrl}
            disabled={form.official}
            onChange={(event) => {
              const baseUrl = event.target.value;
              patch({ baseUrl });
              if (isClaude) form.updateClaudeEnv("ANTHROPIC_BASE_URL", baseUrl);
            }}
          />
        </Labelled>
      ) : null}
      {!isCodex ? (
        <Labelled label="API key">
          <Input
            type="password"
            autoComplete="off"
            placeholder={hasKey ? "Saved in the keychain" : isClaude ? "sk-ant-…" : "…"}
            value={value.apiKey}
            onChange={(event) => {
              const apiKey = event.target.value;
              patch({ apiKey });
              if (isClaude) form.updateClaudeEnv("ANTHROPIC_AUTH_TOKEN", apiKey);
            }}
          />
        </Labelled>
      ) : null}
    </div>
  );
}

/** Claude Code only: the relay note, each tier's default model, and the settings.json editor. */
export function ClaudeFormSections({ engine, form }: { engine: EngineId; form: ProviderForm }) {
  const [jsonOpen, setJsonOpen] = useState(true);
  if (engine !== "claude") return null;
  const { value, slots, setSlots } = form;
  return (
    <>
      {!isOfficialAnthropicEndpoint(value.baseUrl) ? (
        <div className="flex items-center gap-2 rounded-lg border border-charcoal-border bg-charcoal-card px-3 py-2 text-sm text-cream-muted">
          <Cloud className="size-4 shrink-0" aria-hidden />
          <span>Requests go to this endpoint instead of Anthropic's own API.</span>
        </div>
      ) : null}

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <p className={sectionLabel}>Model mapping</p>
          <FetchModelsControl
            fetching={form.fetching}
            error={form.fetchError}
            count={form.fetchedModels.length}
            disabled={!value.baseUrl.trim()}
            onFetch={() => void form.handleFetchModels()}
          />
        </div>
        <FetchedModels models={form.fetchedModels} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {CLAUDE_MODEL_SLOTS.map(({ slot, envKey }) => (
            <Labelled key={slot} label={slotLabels[slot].label}>
              <Input
                list={FETCH_DATALIST_ID}
                placeholder={slotLabels[slot].placeholder}
                value={slots[slot]}
                onChange={(event) => {
                  const model = event.target.value;
                  setSlots((current) => ({ ...current, [slot]: model }));
                  form.updateClaudeEnv(envKey, model);
                }}
              />
            </Labelled>
          ))}
        </div>
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-expanded={jsonOpen}
            onClick={() => setJsonOpen((open) => !open)}
            className="-ml-2 text-sm text-cream"
          >
            <ChevronDown
              className={cn("size-4 transition-transform", !jsonOpen && "-rotate-90")}
              aria-hidden
            />
            JSON config
          </Button>
          <Button type="button" size="xs" variant="outline" onClick={form.handleFormatJson}>
            Format
          </Button>
        </div>
        {jsonOpen ? (
          <>
            <Textarea
              rows={14}
              spellCheck={false}
              aria-label="JSON config"
              aria-invalid={!form.jsonValid || undefined}
              className="font-mono text-xs whitespace-pre"
              value={value.settingsJson}
              onChange={(event) => form.onJsonChange(event.target.value)}
            />
            {form.jsonError ? (
              <p className="text-xs text-cream-muted" role="alert">
                {form.jsonError}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </>
  );
}

/** The flat engines: fetch models, and the model field with the fetched ones offered. */
export function FlatModelSection({ engine, form }: { engine: EngineId; form: ProviderForm }) {
  if (engine === "claude" || engine === "codex") return null;
  return (
    <div className="grid gap-2">
      <FetchModelsControl
        fetching={form.fetching}
        error={form.fetchError}
        count={form.fetchedModels.length}
        disabled={!form.value.baseUrl.trim()}
        onFetch={() => void form.handleFetchModels()}
      />
      <FetchedModels models={form.fetchedModels} />
      <Labelled label="Model">
        <Input
          list={FETCH_DATALIST_ID}
          value={form.value.model}
          onChange={(event) => form.patch({ model: event.target.value })}
        />
      </Labelled>
    </div>
  );
}

/** Codex only: the config.toml editor and the auth.json editor. */
export function CodexFormSections({
  engine,
  form,
  hasKey,
}: {
  engine: EngineId;
  form: ProviderForm;
  hasKey: boolean;
}) {
  if (engine !== "codex") return null;
  const { value, patch } = form;
  return (
    <>
      <Labelled label="config.toml">
        <Textarea
          rows={10}
          spellCheck={false}
          className="font-mono text-xs whitespace-pre"
          value={value.configToml}
          onChange={(event) => patch({ configToml: event.target.value })}
        />
      </Labelled>
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <p className={sectionLabel}>auth.json</p>
          <Button type="button" size="xs" variant="outline" onClick={form.handleFormatAuthJson}>
            Format
          </Button>
        </div>
        <Textarea
          rows={4}
          spellCheck={false}
          aria-label="auth.json"
          aria-invalid={!form.authValid || undefined}
          placeholder={hasKey ? "The saved key stays in the keychain" : undefined}
          className="font-mono text-xs whitespace-pre"
          value={value.authJson}
          onChange={(event) => {
            patch({ authJson: event.target.value });
            form.setAuthError("");
          }}
        />
        {form.authError ? (
          <p className="text-xs text-cream-muted" role="alert">
            {form.authError}
          </p>
        ) : null}
        <FetchModelsControl
          fetching={form.fetching}
          error={form.fetchError}
          count={form.fetchedModels.length}
          disabled={!value.configToml.trim()}
          onFetch={() => void form.handleFetchModels()}
        />
      </div>
    </>
  );
}
