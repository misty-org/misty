import { useNotice, type NoticeAction } from "@misty/ui";

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
