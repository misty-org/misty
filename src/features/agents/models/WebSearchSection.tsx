import { DesktopSettingsSection as Section } from "@/features/settings";
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
      title="Search"
      description="Lets agents search the web. The key stays in this computer’s keychain and goes only to the search service, from this computer."
    >
      <ModelDropdownRow
        id="models.search_provider"
        label="Search service"
        description="The service agents search the web with."
        options={searchProviders.map((item) => ({ value: item.id, label: item.label }))}
      />
      <ModelKeyRow
        label="Search key"
        keyName={`${selected.label} key`}
        description={`${selected.keyHelp} Without a key, agents read pages but don’t search. It can’t be shown again once saved.`}
        providerId={selected.id}
        keys={keys}
      />
    </Section>
  );
}

/**
 * Settings › Models › Connected apps. Agents use the person's apps through their own Composio
 * project on this key, kept like the search key but read only by native code. Without it, agents
 * use each app's web page.
 */
export function ConnectedAppsKeySection({ keys }: { keys: SavedModelKeys }) {
  return (
    <Section title="Connected apps">
      <ModelKeyRow
        label="Composio key"
        description="Goes only to Composio. Without it, agents use each app’s web page."
        providerId="composio"
        keys={keys}
      />
    </Section>
  );
}
