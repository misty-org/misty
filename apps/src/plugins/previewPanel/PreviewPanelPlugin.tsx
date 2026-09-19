import { useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { ActionButton, Field, StatusLine } from "../../shared/pluginChrome";
import type { PluginPanelProps } from "../types";

const scenes = [
  {
    id: "template",
    title: "Template",
    body: "Use this scene as a starting point for new plugin panel layouts.",
  },
  {
    id: "auth",
    title: "Auth Panel",
    body: "Prototype auth forms, account prompts, helper text, and focused action rows.",
  },
];

export function PreviewPanelPlugin({ context }: PluginPanelProps) {
  const [sceneId, setSceneId] = useState(scenes[0].id);
  const [input, setInput] = useState("");
  const scene = scenes.find((item) => item.id === sceneId) ?? scenes[0];

  return (
    <div className="panel-stack">
      <div className="panel-title">
        <h2>Preview Panel</h2>
        <p>Sandbox panel ideas in React before promoting them into a full plugin.</p>
      </div>

      <Field label="Scene">
        <select className="select-input" value={sceneId} onChange={(event) => setSceneId(event.target.value)}>
          {scenes.map((item) => (
            <option key={item.id} value={item.id}>{item.title}</option>
          ))}
        </select>
      </Field>

      <section className="panel-stack rounded-lg border border-white/10 bg-black/20 p-4">
        <div className="panel-title">
          <h2>{scene.title}</h2>
          <p>{scene.body}</p>
        </div>

        <Field label={scene.id === "auth" ? "Email" : "Input"}>
          <input
            className="text-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={scene.id === "auth" ? "you@example.com" : "Try a panel value"}
          />
        </Field>

        <div className="action-row">
          <ActionButton
            type="button"
            onClick={() => context.notify("success", "Preview Panel", `Activated ${scene.title}.`)}
          >
            {scene.id === "auth" ? <ArrowRight size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
            {scene.id === "auth" ? "Continue" : "Primary Action"}
          </ActionButton>
        </div>
      </section>

      <StatusLine>
        Scene state is local to the web panel, so layout experiments can iterate without native ABI rebuilds.
      </StatusLine>
    </div>
  );
}
