import { useEffect, useState } from "react";
import { sensesApi, type ModelSense } from "@/api/assistant/senses";
import { ModelPicker } from "@/features/agents";
import { Button, SkeletonList } from "@/shared/ui";
import {
  DesktopSettingsRow as Row,
  DesktopSettingsSection as Section,
} from "../components/DesktopSettingsUI";

/** One model per sense. Misty's own keys run them; changes apply to new tasks. */
export function ModelSensesSection() {
  const [senses, setSenses] = useState<ModelSense[]>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    sensesApi
      .list()
      .then((result) => active && setSenses(result.senses))
      .catch(() => active && setError("Could not load model choices. Retry to reconnect."));
    return () => {
      active = false;
    };
  }, [attempt]);
  const choose = async (sense: ModelSense, model: string) => {
    const previous = sense.model;
    const update = (value: string) =>
      setSenses((current) =>
        current?.map((item) => (item.id === sense.id ? { ...item, model: value } : item)),
      );
    update(model);
    setSaving(sense.id);
    setError("");
    try {
      await sensesApi.set(sense.id, model);
    } catch (reason) {
      update(previous);
      setError(reason instanceof Error ? reason.message : "Could not save the model. Try again.");
    } finally {
      setSaving("");
    }
  };
  if (!senses && !error)
    return <SkeletonList label="Model choices" rows={4} leading="none" trailing />;
  if (!senses)
    return (
      <div className="grid justify-items-start gap-3">
        <p role="alert" className="text-sm text-cream">
          {error}
        </p>
        <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
          Retry
        </Button>
      </div>
    );
  return (
    <>
      {error && (
        <p role="alert" className="mb-4 text-sm text-cream">
          {error}
        </p>
      )}
      <Section title="Senses">
        {senses.map((sense) => (
          <Row key={sense.id} label={sense.name} description={sense.description}>
            <ModelPicker
              label={`${sense.name} model`}
              options={sense.options}
              value={sense.model}
              defaultModel={sense.default_model}
              defaultLabel="Misty default"
              disabled={saving === sense.id}
              className="justify-self-end max-w-full"
              onChange={(model) => void choose(sense, model)}
            />
          </Row>
        ))}
      </Section>
    </>
  );
}
