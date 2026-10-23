import { Input, OptionSelect } from "@/shared/ui";
import type { AgentMethodInput, AgentMethodInputs } from "@/api/ai/agent-methods";

/** Keep unanswered booleans distinct from false; required questions must be answered explicitly. */
export function AgentMethodInputFields({
  fields,
  values,
  onChange,
}: {
  fields: AgentMethodInput[];
  values: AgentMethodInputs;
  onChange(values: AgentMethodInputs): void;
}) {
  const update = (key: string, value: string | number | boolean | undefined) => {
    const next = { ...values };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onChange(next);
  };
  return (
    <>
      {fields.map((field) => (
        <label key={field.key}>
          {field.label}
          {field.required ? " *" : ""}
          {field.type === "boolean" || field.type === "choice" ? (
            <OptionSelect
              aria-label={field.label}
              value={values[field.key] === undefined ? "" : String(values[field.key])}
              options={[
                { value: "", label: "Choose an answer" },
                ...(field.type === "boolean"
                  ? [
                      { value: "true", label: "Yes" },
                      { value: "false", label: "No" },
                    ]
                  : (field.options ?? []).map((value) => ({ value, label: value }))),
              ]}
              onValueChange={(value) =>
                update(
                  field.key,
                  value === "" ? undefined : field.type === "boolean" ? value === "true" : value,
                )
              }
            />
          ) : (
            <Input
              aria-label={field.label}
              required={field.required}
              type={field.type === "number" ? "number" : "text"}
              step={field.type === "number" ? "any" : undefined}
              maxLength={2000}
              value={values[field.key] === undefined ? "" : String(values[field.key])}
              onChange={(e) =>
                update(
                  field.key,
                  e.target.value === ""
                    ? undefined
                    : field.type === "number"
                      ? Number(e.target.value)
                      : e.target.value,
                )
              }
            />
          )}
        </label>
      ))}
    </>
  );
}
