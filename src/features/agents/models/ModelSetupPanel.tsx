import { useModelSetting } from "./ModelChoiceRows";
import { useChatgptAccount, useModelTest, useProviderModels } from "./modelAccounts";
import { useSavedModelKeys } from "./modelKeys";
import {
  defaultAgentModel,
  modelSuggestions,
  providerById,
  qualifiedModel,
} from "./modelProviders";
import { ModelTestLines } from "./ModelTestRow";
import { BrandIcon, Button, ErrorNotification, Input, Label, Skeleton, Spinner } from "@/shared/ui";
import { useEffect, useRef, useState } from "react";

/**
 * The wizard's last step: a model account for agents. Sign in with ChatGPT or OpenRouter, or
 * paste a key from any provider; then pick the agent model and check it. Settings › Models
 * has the rest.
 */
export function ModelSetupPanel() {
  const keys = useSavedModelKeys();
  const chatgpt = useChatgptAccount();
  const provider = useModelSetting("models.provider");
  const agent = useModelSetting("models.agent_model");
  const test = useModelTest();
  const [key, setKey] = useState("");
  const [adding, setAdding] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const selected = providerById(chosen ?? "");
  const listed = useProviderModels(chosen ?? "", Boolean(chosen));
  const suggestions = selected ? modelSuggestions(selected, "agent", listed) : [];

  // The first sensible model is chosen for the person once the provider lists its models.
  const defaulted = useRef("");
  const { value: agentModel, set: setAgentModel } = agent;
  useEffect(() => {
    if (!chosen || !listed?.length || defaulted.current === chosen) return;
    defaulted.current = chosen;
    if (agentModel.startsWith(`${chosen}/`)) return;
    const first = defaultAgentModel(chosen, listed);
    if (first) setAgentModel(first);
  }, [chosen, listed, agentModel, setAgentModel]);

  const choose = (providerId: string) => {
    setChosen(providerId);
    if (providerId !== provider.value) provider.set(providerId);
  };
  const addKey = async () => {
    setAdding(true);
    const added = await keys.add(key);
    setAdding(false);
    if (!added) return;
    setKey("");
    choose(added.provider);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          disabled={chatgpt.busy}
          aria-busy={chatgpt.busy}
          onClick={() => void chatgpt.signIn().then((next) => next?.planUsage && choose("chatgpt"))}
        >
          {chatgpt.busy ? (
            <Spinner size="sm" label={false} />
          ) : (
            <BrandIcon brand="openai" size={16} />
          )}
          Sign in with ChatGPT
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            void keys.signInToOpenRouter().then((added) => added && choose("openrouter"))
          }
        >
          <BrandIcon brand="openrouter" size={16} />
          Sign in with OpenRouter
        </Button>
      </div>
      <form
        className="grid gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          void addKey();
        }}
      >
        <Label htmlFor="setup-model-key" className="text-sm text-cream">
          Or paste a key
        </Label>
        <div className="flex gap-2">
          <Input
            id="setup-model-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            placeholder="sk-…, AIza…, an Ollama Cloud key"
            disabled={adding}
            onChange={(event) => setKey(event.target.value)}
          />
          <Button
            type="submit"
            variant="outline"
            disabled={adding || !key.trim()}
            aria-busy={adding}
          >
            {adding ? <Spinner size="sm" label={false} /> : null}
            Add
          </Button>
        </div>
      </form>
      <ErrorNotification message={chatgpt.error || keys.error} />
      {chosen ? (
        <div className="grid gap-1.5">
          <Label htmlFor="setup-agent-model" className="text-sm text-cream">
            Agent model
          </Label>
          {listed === null ? (
            <Skeleton aria-label="Models" className="h-9 w-full rounded-md" />
          ) : (
            <>
              <Input
                id="setup-agent-model"
                key={agent.value}
                defaultValue={agent.value}
                list="setup-agent-models"
                spellCheck={false}
                autoComplete="off"
                onBlur={(event) => {
                  const next = qualifiedModel(event.currentTarget.value, chosen);
                  if (next && next !== agent.value) agent.set(next);
                }}
              />
              <datalist id="setup-agent-models">
                {suggestions.map((id) => (
                  <option key={id} value={id} />
                ))}
              </datalist>
            </>
          )}
          <div className="mt-1 flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={!agent.value || test.running}
              aria-busy={test.running}
              onClick={() => void test.run()}
            >
              {test.running ? <Spinner size="sm" label={false} /> : null}
              Check it
            </Button>
            <ErrorNotification message={test.error} />
          </div>
          {test.result ? <ModelTestLines result={test.result} /> : null}
        </div>
      ) : null}
    </div>
  );
}
