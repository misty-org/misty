import { Bot, Cloud, Cpu } from "lucide-react";
import { useEffect, useState } from "react";
import { EngineMark, hasEngineMark } from "@/features/engine-config/EngineMark";
import { Field, Input, OptionSelect } from "@/shared/ui";
import {
  listEngineModels,
  listEngines,
  mistyEngine,
  type EngineInfo,
  type EngineModel,
} from "./enginesApi";

/**
 * Which engine an agent runs on: Misty's own, or one of the outside engines the person has
 * installed. An outside engine signs in and picks its provider by itself; Misty only starts it.
 */
export function AgentEngineField(props: {
  engine: string;
  model: string;
  /** Misty's own agent always runs on Misty. */
  locked?: boolean;
  onEngine(engine: string): void;
  onModel(model: string): void;
}) {
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  useEffect(() => {
    let live = true;
    void listEngines()
      .then((found) => live && setEngines(found))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  const engine = props.engine || mistyEngine;
  const [models, setModels] = useState<{ engine: string; list: EngineModel[] }>({
    engine: "",
    list: [],
  });
  useEffect(() => {
    if (engine === mistyEngine) return;
    let live = true;
    void listEngineModels(engine)
      .then((list) => live && setModels({ engine, list }))
      .catch(() => live && setModels({ engine, list: [] }));
    return () => {
      live = false;
    };
  }, [engine]);
  const offered = models.engine === engine ? models.list : [];
  const modelOptions = [
    { value: "", label: "The engine's default", icon: Cpu },
    ...offered.map((model) => ({ value: model.id, label: model.id, icon: Cpu })),
  ];
  // A model typed or saved earlier that the engine no longer lists still shows.
  if (props.model && !offered.some((model) => model.id === props.model))
    modelOptions.push({ value: props.model, label: props.model, icon: Cpu });
  const options = [
    { value: mistyEngine, label: "Misty", icon: Cloud },
    ...engines.map((item) => ({
      value: item.id,
      label: item.installed ? item.name : `${item.name} (not installed)`,
      icon: hasEngineMark(item.id) ? <EngineMark engine={item.id} size={16} /> : Bot,
    })),
  ];
  // An engine saved earlier still shows while the list loads, or if its adapter is gone.
  if (!options.some((option) => option.value === engine))
    options.push({ value: engine, label: engine, icon: Bot });
  return (
    <>
      <Field label="Engine">
        <OptionSelect
          aria-label="Engine"
          value={engine}
          options={options}
          disabled={props.locked}
          onValueChange={props.onEngine}
        />
      </Field>
      {engine !== mistyEngine ? (
        <Field label="Model">
          {offered.length ? (
            <OptionSelect
              aria-label="Model"
              value={props.model}
              options={modelOptions}
              onValueChange={props.onModel}
            />
          ) : (
            <Input
              maxLength={200}
              placeholder="The engine's default"
              value={props.model}
              onChange={(event) => props.onModel(event.target.value)}
            />
          )}
        </Field>
      ) : null}
    </>
  );
}
