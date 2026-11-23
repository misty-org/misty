import type { AiProgressItem } from "../runs/invocations/invocation_types";

const limits = [
  {
    match: /\bapp_action_limit_reached\b|\bapp actions for this month\b/i,
    notice:
      "This account has used this month's app actions, so the agent couldn't use your " +
      "connected apps. They renew with your plan's month; whoever runs your Misty server can " +
      "add more.",
  },
];

export function usageLimitNotice(text: string | undefined): string | null {
  if (!text) return null;
  return limits.find((limit) => limit.match.test(text))?.notice ?? null;
}

export function usageLimitNotices(items: AiProgressItem[]): string[] {
  const notices = new Set<string>();
  for (const item of items) {
    if (item.type !== "tool") continue;
    const notice = usageLimitNotice(item.error) ?? usageLimitNotice(item.activity?.output);
    if (notice) notices.add(notice);
  }
  return [...notices];
}
