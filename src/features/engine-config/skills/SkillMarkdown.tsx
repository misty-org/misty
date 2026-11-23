// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
import type { ReactNode } from "react";
import { HostMarkdown } from "../host";
import { PaneLoading, Surface, Text } from "@misty/ui";
import { t } from "./strings";

interface SkillContentState {
  path: string;
  markdown: string;
  truncated: boolean;
}

export function SkillMarkdown({
  loading,
  error,
  content,
  loadingLabel,
  failed,
}: {
  loading: boolean;
  error: string | null;
  content: SkillContentState | null;
  loadingLabel: string;
  failed?: ReactNode;
}) {
  return (
    <Surface tone="faint" radius="xl" className="min-h-24 max-h-80 shrink-0 overflow-y-auto p-3">
      {loading ? (
        <PaneLoading label={loadingLabel} inline />
      ) : error ? (
        failed
      ) : content ? (
        <>
          <HostMarkdown>{content.markdown}</HostMarkdown>
          {content.truncated ? (
            <Text bare as="p" size="meta" tone="muted" className="mt-2">
              {t("detail.contentTruncated")}
            </Text>
          ) : null}
        </>
      ) : null}
    </Surface>
  );
}
