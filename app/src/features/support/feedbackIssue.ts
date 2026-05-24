export const publicFeedbackRepository = "https://github.com/misty-org/misty-public";

export type FeedbackKind = "bug" | "idea" | "confusing" | "accessibility";
export type FeedbackFrequency = "once" | "sometimes" | "always" | "unknown";

export interface FeedbackDraft {
  kind: FeedbackKind;
  summary: string;
  area: string;
  details: string;
  expected: string;
  frequency: FeedbackFrequency;
}

export interface FeedbackClientContext {
  appVersion?: string;
  platform?: string;
  releaseChannel?: string;
}

const kindLabels: Record<FeedbackKind, string> = {
  bug: "Bug",
  idea: "Idea",
  confusing: "Confusing experience",
  accessibility: "Accessibility",
};

const frequencyLabels: Record<FeedbackFrequency, string> = {
  once: "Once",
  sometimes: "Sometimes",
  always: "Every time",
  unknown: "Not sure",
};

export function buildPublicFeedbackIssueUrl(
  draft: FeedbackDraft,
  client: FeedbackClientContext = {},
): string {
  const summary = cleanLine(draft.summary, 120) || "Feedback from Misty public beta";
  const params = new URLSearchParams({
    title: `[${kindLabels[draft.kind]}] ${summary}`,
    body: feedbackIssueBody(draft, client),
  });
  return `${publicFeedbackRepository}/issues/new?${params.toString()}`;
}

function feedbackIssueBody(draft: FeedbackDraft, client: FeedbackClientContext): string {
  const details = cleanBlock(draft.details, 4_000) || "Not provided";
  const expected = cleanBlock(draft.expected, 2_000) || "Not provided";
  const appVersion = cleanLine(client.appVersion ?? "Unknown", 80);
  const platform = cleanLine(client.platform ?? "Unknown", 80);
  const releaseChannel = cleanLine(client.releaseChannel ?? "Unknown", 80);
  return [
    "## Feedback",
    "",
    `**Type:** ${kindLabels[draft.kind]}`,
    `**Area:** ${cleanLine(draft.area, 80) || "General"}`,
    `**Frequency:** ${frequencyLabels[draft.frequency]}`,
    "",
    details,
    "",
    "## What I expected",
    "",
    expected,
    "",
    "## Misty build",
    "",
    `- Version: ${appVersion}`,
    `- Platform: ${platform}`,
    `- Channel: ${releaseChannel}`,
    "",
    "_No diagnostic bundle was uploaded automatically. Attach the locally generated bundle only after reviewing it._",
  ].join("\n");
}

function cleanLine(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanBlock(value: string, maxLength: number): string {
  return value.replace(/\r\n/g, "\n").trim().slice(0, maxLength);
}
