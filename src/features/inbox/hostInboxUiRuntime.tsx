import { reportSystemError } from "@/features/activity";
import { MistyFilePicker, readFilesFromPaths } from "@/features/picker";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import type { InboxAttachmentPickerProps, InboxUiRuntime } from "./inboxUiRuntime";
function Picker(props: InboxAttachmentPickerProps) {
  const choose = async (paths: string[]) => {
    try {
      props.onFiles(await readFilesFromPaths(paths));
    } catch (error) {
      props.onCancel();
      reportSystemError({
        error,
        scope: "inbox:attachments",
        title: "Attachments could not be read",
        target: { kind: "route", href: "/inbox" },
      });
    }
  };
  return (
    <MistyFilePicker
      mode="file"
      multiple
      title="Attach files"
      onCancel={props.onCancel}
      onSelect={(path) => void choose([path])}
      onSelectMany={(paths) => void choose(paths)}
    />
  );
}
export const hostInboxUiRuntime: InboxUiRuntime = {
  Picker,
  openLink: openExternalLink,
  report: reportSystemError,
};
