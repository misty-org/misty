import { useEffect, useState } from "react";
import { Field, Input, Mark, OptionSelect } from "@misty/ui";
import { listEngineModels, mistyEngine, useEnginesList, type EngineModel } from "./engines_api";

export function AgentEngineField(props: {
  engine: string;
  model: string;
  locked?: boolean;
  onEngine(engine: string): void;
  onModel(model: string): void;
}) {
  const engines = useEnginesList().data ?? [];
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
    { value: "", label: "The engine's default" },
    ...offered.map((model) => ({ value: model.id, label: model.label })),
  ];
  if (props.model && !offered.some((model) => model.id === props.model))
    modelOptions.push({ value: props.model, label: props.model });
  const options = [
    ...engines.map((item) => ({
      value: item.id,
      label: item.installed ? item.name : `${item.name} (not installed)`,
      icon: <Mark of={`engine:${item.id}`} label={item.name} size={16} aria-hidden />,
    })),
  ];
  if (!options.some((option) => option.value === engine))
    options.push({
      value: engine,
      label: engine,
      icon: <Mark of={`engine:${engine}`} size={16} />,
    });
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
