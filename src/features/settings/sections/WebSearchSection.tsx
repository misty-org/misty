import {
  DesktopSettingsRow as Row,
  DesktopSettingsSection as Section,
} from "../components/DesktopSettingsUI";
import { definitionById, fromLegacy } from "../profiles/registry";
import { useSettingsProfiles } from "../profiles/store";
import { ChoiceControl, SwitchControl } from "../SettingsControls";
import { useSettingsStore } from "../store/useSettingsStore";

const engines = [
  { value: "parallel", label: "Parallel" },
  { value: "perplexity", label: "Perplexity" },
  { value: "exa", label: "Exa" },
];

function usePreference(id: string) {
  const d = definitionById.get(id)!;
  const store = useSettingsStore();
  const ready = useSettingsProfiles((s) => s.ready);
  const section = store.settings?.document[d.section] as Record<string, unknown> | undefined;
  const value = fromLegacy(d, section?.[d.key]);
  return {
    label: d.label,
    value,
    disabled: store.working || !ready,
    update: (next: string | boolean) => void store.updateSetting(d.section, d.key, next),
  };
}

/** Misty's own web search and when agents may suggest a paid search app. */
export function WebSearchSection() {
  const search = usePreference("agents.web_search");
  const engine = usePreference("agents.web_search_engine");
  const offer = usePreference("agents.offer_search_apps");
  const enabled = Boolean(search.value);
  return (
    <Section
      title="Web search"
      description="Agents search the web through Misty, so you never sign in to a search service. Searches count toward your AI usage."
    >
      <Row
        label={search.label}
        description="Lets agents look up current information and cite the pages they used."
      >
        <SwitchControl checked={enabled} disabled={search.disabled} onChange={search.update} />
      </Row>
      <Row
        label={engine.label}
        description="The service that runs each search, on Misty's account."
        muted={!enabled}
        indent
      >
        <ChoiceControl
          value={String(engine.value)}
          options={engines}
          disabled={engine.disabled || !enabled}
          onValueChange={engine.update}
        />
      </Row>
      <Row
        label={offer.label}
        description={
          "Lets agents suggest connecting a paid search app such as Exa or Tavily when web search " +
          "falls short. When off, they connect one only if you name it."
        }
      >
        <SwitchControl
          checked={Boolean(offer.value)}
          disabled={offer.disabled}
          onChange={offer.update}
        />
      </Row>
    </Section>
  );
}
