import { useNotice, type NoticeAction } from "@/shared/ui";

/**
 * A failure as an error notice that stays while `message` is set, at most with one way out. It
 * renders nothing itself, so it can sit where the failure happens, even inside a branch that
 * returns early. Forms show their failures under the field instead (`Field error`, `FieldError`).
 */
export function ErrorNotice({
  message,
  action,
  onDismiss,
}: {
  message: string | null | undefined;
  action?: NoticeAction;
  onDismiss?: () => void;
}) {
  useNotice(Boolean(message), { message: message ?? "", tone: "error", action, onDismiss });
  return null;
}
