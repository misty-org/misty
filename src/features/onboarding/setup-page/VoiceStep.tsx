import { Field, OptionSelect } from "@misty/ui";
import { speechLanguages } from "@/features/voice";

export function VoiceStep(props: { language: string; onLanguage(language: string): void }) {
  return (
    <Field label="Language" layout="inline">
      <OptionSelect
        className="w-50"
        value={props.language}
        options={speechLanguages}
        onValueChange={props.onLanguage}
      />
    </Field>
  );
}
