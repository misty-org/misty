import { DesktopSettingsSection as Section } from "../components/DesktopSettingsUI";
import { ModelDropdownRow, useModelSetting } from "./ModelChoiceRows";
import { ModelKeyRow } from "./ModelKeyRow";
import type { SavedModelKeys } from "./modelKeys";

/** The services web search can run on, with where each key comes from. */
const searchProviders = [
  {
    id: "decodo",
    label: "Decodo",
    keyHelp: "Paste the Web Scraping API key from your Decodo dashboard.",
  },
  { id: "serper", label: "Serper", keyHelp: "Paste an API key from serper.dev." },
];

/**
 * Settings › Models › Web search. Agents search the web from this computer on the person's
 * own search key, kept in the keychain like a model key and handed only to the agent runtime
 * here. Without a key, agents don't get web search.
 */
export function WebSearchSection({ keys }: { keys: SavedModelKeys }) {
  const provider = useModelSetting("models.search_provider");
  const selected =
    searchProviders.find((item) => item.id === provider.value) ?? searchProviders[0]!;
  return (
    <Section
      title="Web search"
      description="Lets agents search the web. The key stays in this device’s keychain and goes only to the search service, from this computer."
    >
      <ModelDropdownRow
        id="models.search_provider"
        label="Search service"
        description="The service agents search the web with."
        options={searchProviders.map((item) => ({ value: item.id, label: item.label }))}
      />
      <ModelKeyRow
        label="Search key"
        description={`${selected.keyHelp} Without a key, agents read pages but don’t search. It can’t be shown again once saved.`}
        providerId={selected.id}
        saved={keys.saved}
        onSave={keys.save}
        onRemove={keys.remove}
      />
    </Section>
  );
}
