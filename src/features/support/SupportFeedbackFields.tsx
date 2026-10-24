import { cn, Input, OptionSelect, Pressable, Textarea } from "@/shared/ui";
import type { FeedbackDraft, FeedbackKind } from "./feedbackIssue";
import { FeedbackField } from "./SupportRecoveryParts";

const feedbackKinds: Array<{ id: FeedbackKind; label: string }> = [
  { id: "bug", label: "Something broke" },
  { id: "confusing", label: "Something was confusing" },
  { id: "idea", label: "I have an idea" },
  { id: "accessibility", label: "Accessibility" },
];

/** The parts of a feedback ticket the person writes: its kind, area, frequency and text. */
export function SupportFeedbackFields({
  draft,
  updateDraft,
}: {
  draft: FeedbackDraft;
  updateDraft: <Key extends keyof FeedbackDraft>(key: Key, value: FeedbackDraft[Key]) => void;
}) {
  return (
    <>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-xs font-medium text-cream">
          What kind of feedback is it?
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {feedbackKinds.map((kind) => (
            <Pressable
              key={kind.id}
              className={cn(
                "rounded-md border px-3 py-2.5 text-xs",
                draft.kind === kind.id
                  ? "border-charcoal-active bg-charcoal-hover text-cream-bright"
                  : "border-charcoal-border bg-charcoal-bg text-cream-muted hover:text-cream",
              )}
              aria-pressed={draft.kind === kind.id}
              onClick={() => updateDraft("kind", kind.id)}
            >
              {kind.label}
            </Pressable>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <FeedbackField label="Area">
          <OptionSelect
            value={draft.area}
            onValueChange={(value) => updateDraft("area", value)}
            options={[
              "General",
              "Onboarding",
              "Spaces",
              "Chat",
              "Notes",
              "Drawings",
              "Files",
              "Code",
              "Browser",
              "Agents",
              "Settings",
            ].map((area) => ({ value: area, label: area }))}
          />
        </FeedbackField>
        <FeedbackField label="How often?">
          <OptionSelect
            value={draft.frequency}
            onValueChange={(value) => updateDraft("frequency", value as FeedbackDraft["frequency"])}
            options={[
              { value: "unknown", label: "Not sure" },
              { value: "once", label: "Once" },
              { value: "sometimes", label: "Sometimes" },
              { value: "always", label: "Every time" },
            ]}
          />
        </FeedbackField>
      </div>

      <FeedbackField label="Short summary" required>
        <Input
          required
          value={draft.summary}
          maxLength={120}
          placeholder="What went wrong or could be better?"
          onChange={(event) => updateDraft("summary", event.target.value)}
        />
      </FeedbackField>
      <FeedbackField label="What happened?" required>
        <Textarea
          required
          value={draft.details}
          maxLength={4_000}
          rows={5}
          placeholder="Tell us what you were doing and what you saw. Steps that reproduce a bug are especially useful."
          onChange={(event) => updateDraft("details", event.target.value)}
        />
      </FeedbackField>
      <FeedbackField label="What did you expect?">
        <Textarea
          value={draft.expected}
          maxLength={2_000}
          rows={3}
          placeholder="Describe the result that would have felt correct."
          onChange={(event) => updateDraft("expected", event.target.value)}
        />
      </FeedbackField>
    </>
  );
}
