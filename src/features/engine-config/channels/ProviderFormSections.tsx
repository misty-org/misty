// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { ChevronDown, Cloud, Globe } from "lucide-react";
import { useState, type ReactNode } from "react";
import { EngineMark, hasEngineMark } from "../EngineMark";
import {
  Avatar,
  AvatarFallback,
  Button,
  cn,
  FieldError,
  Input,
  Textarea,
  Pressable,
  OverflowFadeText,
  Surface,
  Text,
} from "@/shared/ui";
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

function SectionLabel({ children }: { children: string }) {
  return (
    <Text as="p" tone="muted" weight="medium" className="text-sm">
      {children}
    </Text>
  );
}

/** One preset to pick: an edged tile, filled once picked, that washes on hover until then. */
function Choice({
  selected,
  onSelect,
  className,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Surface
      tone={selected ? "well" : "none"}
      edge={selected ? "strong" : "hairline"}
      radius="lg"
      className="flex min-w-0 overflow-hidden"
    >
      <Text bare as="div" tone={selected ? "bright" : "muted"} className="flex min-w-0 flex-1">
        <Pressable
          aria-pressed={selected}
          wash={selected ? undefined : "control"}
          onClick={onSelect}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-sm transition-colors",
            className,
          )}
        >
          {children}
        </Pressable>
      </Text>
    </Surface>
  );
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1.5">
      <Text tone="muted" className="text-sm">
        {label}
      </Text>
      {children}
    </label>
  );
}

/** A preset's own mark (never inferred from its default model, which for a relay can be another
 *  brand's), or a neutral monogram when it has no public one. */
function PresetMark({ preset }: { preset: ProviderPreset }) {
  if (preset.mark) return <BrandMark mark={preset.mark} size={16} />;
  return (
    <Avatar size="xs" aria-hidden>
      <AvatarFallback>{preset.name.charAt(0).toUpperCase()}</AvatarFallback>
    </Avatar>
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
      <SectionLabel>Official API</SectionLabel>
      <Choice selected={official} onSelect={onSelect} className="gap-3 p-3">
        <span className="flex size-8 shrink-0 items-center justify-center">
          {hasEngineMark(engine) ? <EngineMark engine={engine} size={16} /> : <Globe />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <Text bare tone="bright">
            {isClaude ? "Anthropic official API" : "OpenAI official API"}
          </Text>
          <Text bare tone="muted" className="text-xs">
            {isClaude
              ? "Your own key, straight to https://api.anthropic.com."
              : "Your own OPENAI_API_KEY, straight to https://api.openai.com/v1."}
          </Text>
        </span>
      </Choice>
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
      <SectionLabel>Third-party providers</SectionLabel>
      <div className="grid grid-cols-3 gap-2">
        <Choice selected={!official && !matchedPreset} onSelect={onSelectCustom}>
          <Globe className="shrink-0" aria-hidden />
          <OverflowFadeText full>Custom</OverflowFadeText>
        </Choice>
        {presets.map((preset) => (
          <Choice
            key={preset.name}
            selected={matchedPreset?.name === preset.name}
            onSelect={() => onSelectPreset(preset)}
          >
            <PresetMark preset={preset} />
            <OverflowFadeText full>{preset.name}</OverflowFadeText>
          </Choice>
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
      <Button type="button" size="sm" onClick={onFetch} loading={fetching} disabled={disabled}>
        Fetch models
      </Button>
      {error ? (
        <Text full role="alert" tone="muted" className="text-xs">
          {error}
        </Text>
      ) : count > 0 ? (
        <Text bare tone="muted" className="text-xs">
          {count === 1 ? "1 model" : `${count} models`}
        </Text>
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

/** Name and note, the URL, and the key (not for Codex, which keeps it in auth.json). Claude
 *  Code's fields mirror every keystroke into the JSON editor's env; Codex's URL is config.toml's. */
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
      <Labelled label="API URL">
        <Input
          required
          placeholder="https://…"
          value={form.baseUrl}
          disabled={form.official}
          aria-invalid={form.baseUrlError ? true : undefined}
          aria-describedby={form.baseUrlError ? "engine-channel-url-error" : undefined}
          onBlur={form.touchBaseUrl}
          onChange={(event) => {
            const baseUrl = event.target.value;
            if (isCodex) {
              form.setCodexBaseUrl(baseUrl);
              return;
            }
            patch({ baseUrl });
            if (isClaude) form.updateClaudeEnv("ANTHROPIC_BASE_URL", baseUrl);
          }}
        />
        <FieldError id="engine-channel-url-error" message={form.baseUrlError} />
      </Labelled>
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
        <Surface tone="card" edge="hairline" radius="lg" className="px-3 py-2">
          <Text bare as="div" tone="muted" className="flex items-center gap-2 text-sm">
            <Cloud className="shrink-0" aria-hidden />
            <span>Requests go to this endpoint instead of Anthropic's own API.</span>
          </Text>
        </Surface>
      ) : null}

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <SectionLabel>Model mapping</SectionLabel>
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
            variant="quiet"
            size="sm"
            aria-expanded={jsonOpen}
            onClick={() => setJsonOpen((open) => !open)}
            className="-ml-2 text-sm"
          >
            <ChevronDown
              className={cn("transition-transform", !jsonOpen && "-rotate-90")}
              aria-hidden
            />
            JSON config
          </Button>
          <Button type="button" size="sm" onClick={form.handleFormatJson}>
            Format
          </Button>
        </div>
        {jsonOpen ? (
          <>
            <Textarea
              variant="code"
              rows={14}
              aria-label="JSON config"
              aria-invalid={!form.jsonValid || undefined}
              value={value.settingsJson}
              onChange={(event) => form.onJsonChange(event.target.value)}
            />
            {form.jsonError ? (
              <Text tone="muted" wrap className="text-xs" role="alert">
                {form.jsonError}
              </Text>
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
          variant="code"
          rows={10}
          value={value.configToml}
          onChange={(event) => patch({ configToml: event.target.value })}
        />
      </Labelled>
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <SectionLabel>auth.json</SectionLabel>
          <Button type="button" size="sm" onClick={form.handleFormatAuthJson}>
            Format
          </Button>
        </div>
        <Textarea
          variant="code"
          rows={4}
          aria-label="auth.json"
          aria-invalid={!form.authValid || undefined}
          placeholder={hasKey ? "The saved key stays in the keychain" : undefined}
          value={value.authJson}
          onChange={(event) => {
            patch({ authJson: event.target.value });
            form.setAuthError("");
          }}
        />
        {form.authError ? (
          <Text tone="muted" wrap className="text-xs" role="alert">
            {form.authError}
          </Text>
        ) : null}
        <FetchModelsControl
          fetching={form.fetching}
          error={form.fetchError}
          count={form.fetchedModels.length}
          disabled={!form.baseUrl.trim()}
          onFetch={() => void form.handleFetchModels()}
        />
      </div>
    </>
  );
}
