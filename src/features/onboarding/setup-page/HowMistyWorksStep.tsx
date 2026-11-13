import { NumberedList, Text } from "@/shared/ui";

const points = [
  "An AI does the work. You pick which one, and some are free.",
  "Misty is where you work with it. You ask, and watch it work.",
  "Your space is where you build, on your own or with others.",
];

/**
 * The first setup step, before the person picks an AI: what the AI, Misty and a space are each
 * for, and that Misty doesn't decide how an AI behaves. Its two parts sit in the step's own
 * column, which spaces them.
 */
export function HowMistyWorksStep() {
  return (
    <>
      <NumberedList items={points} />
      <Text size="body" tone="muted" wrap>
        Each AI comes from its maker. Misty shows you what it does, but doesn't control how it
        behaves.
      </Text>
    </>
  );
}
