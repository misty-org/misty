import type { ComponentType } from "react";
export interface InboxAttachmentPickerProps {
  onCancel(): void;
  onFiles(files: File[]): void;
}
export interface InboxUiRuntime {
  Picker: ComponentType<InboxAttachmentPickerProps>;
  openLink(url: string): Promise<unknown>;
  report(options: {
    intent?: "background" | "user-action";
    error: unknown;
    scope: string;
    title: string;
    accountId?: string;
    target: { kind: "route"; href: string };
  }): void;
}
