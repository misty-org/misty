// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { Cloud, Globe } from "lucide-react";
import { useState, type ReactElement, type ReactNode } from "react";
import {
  Button,
  ChoiceList,
  ChoiceTile,
  Field,
  FoldChevron,
  Input,
  Mark,
  Textarea,
  Surface,
  Text,
} from "@misty/ui";
import type { EngineId } from "./engines";
import {
  CLAUDE_MODEL_SLOTS,
  isOfficialAnthropicEndpoint,
  type ClaudeModelSlot,
  type ProviderPreset,
} from "./provider_presets";
import type { ProviderForm } from "./use_provider_form";

const FETCH_DATALIST_ID = "engine-channel-fetched-models";

const slotLabels: Record<ClaudeModelSlot, { label: string; placeholder: string }> = {
  fable: { label: "Fable default model", placeholder: "e.g. claude-fable-5" },
  sonnet: { label: "Sonnet default model", placeholder: "e.g. claude-sonnet-4-5" },
  opus: { label: "Opus default model", placeholder: "e.g. claude-opus-4-5" },
  haiku: { label: "Haiku default model", placeholder: "e.g. claude-haiku-4-5" },
};

function SectionLabel({ children }: { children: string }) {
  return (
    <Text as="p" size="meta" tone="muted" weight="medium">
      {children}
    </Text>
  );
}

function Labelled({
  label,
  error,
  children,
}: {
  label: string;
  error?: ReactNode;
  children: ReactElement<{ id?: string }>;
}) {
  return (
    <Field label={label} error={error} className="min-w-0">
      {children}
    </Field>
  );
}

function PresetMark({ preset }: { preset: ProviderPreset }) {
  return <Mark of={preset.mark} label={preset.name} size={16} aria-hidden />;
}

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
  const label = isClaude ? "Anthropic official API" : "OpenAI official API";
  return (
    <div className="grid gap-2">
      <SectionLabel>Official API</SectionLabel>
      <ChoiceList
        label="Official API"
        options={[
          {
            value: "official",
            label,
            description: isClaude
              ? "Your own key, straight to https://api.anthropic.com."
              : "Your own OPENAI_API_KEY, straight to https://api.openai.com/v1.",
          },
        ]}
        selected={official ? ["official"] : []}
        onSelect={onSelect}
      />
    </div>
  );
}

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
      <div role="radiogroup" aria-label="Third-party providers" className="grid grid-cols-4 gap-1">
        <ChoiceTile
          radio
          label="Custom"
          caption="Custom"
          selected={!official && !matchedPreset}
          onSelect={onSelectCustom}
        >
          <Globe aria-hidden />
        </ChoiceTile>
        {presets.map((preset) => (
          <ChoiceTile
            key={preset.name}
            radio
            label={preset.name}
            caption={preset.name}
            selected={matchedPreset?.name === preset.name}
            onSelect={() => onSelectPreset(preset)}
          >
            <PresetMark preset={preset} />
          </ChoiceTile>
        ))}
      </div>
    </div>
  );
}

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
      <Button type="button" size="sm" onClick={onFetch} disabled={disabled || fetching}>
        Fetch models
      </Button>
      {error ? (
        <Text full role="alert" size="meta" tone="muted">
          {error}
        </Text>
      ) : count > 0 ? (
        <Text bare size="meta" tone="muted">
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

export function ProviderBasicFields({
  engine,
  form,
  hasKey,
}: {
  engine: EngineId;
  form: ProviderForm;
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
      <Labelled label="API URL" error={form.baseUrlError}>
        <Input
          required
          placeholder="https://…"
          value={form.baseUrl}
          disabled={form.official}
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

export function ClaudeFormSections({ engine, form }: { engine: EngineId; form: ProviderForm }) {
  const [jsonOpen, setJsonOpen] = useState(true);
  if (engine !== "claude") return null;
  const { value, slots, setSlots } = form;
  return (
    <>
      {!isOfficialAnthropicEndpoint(value.baseUrl) ? (
        <Surface tone="faint" radius="xl" className="px-3 py-2">
          <Text bare as="div" size="meta" tone="muted" className="flex items-center gap-2">
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
            className="-ml-2"
          >
            <FoldChevron open={jsonOpen} />
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
              <Text size="meta" tone="muted" wrap role="alert">
                {form.jsonError}
              </Text>
            ) : null}
          </>
        ) : null}
      </div>
    </>
  );
}

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
          <Text size="meta" tone="muted" wrap role="alert">
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
