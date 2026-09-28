import { useSetupStore } from "@/features/installer";
import { memo, useEffect, useState } from "react";
import { Notification } from "@/shared/ui";
import { workStatusToastDurationMs } from "./styles";

export const WorkStatusPopup = memo(function WorkStatusPopup() {
  const setupInstalling = useSetupStore(
    (state) => state.installState === "installing" || state.busy,
  );
  const [visibleSummary, setVisibleSummary] = useState<{ title: string; detail: string } | null>(
    null,
  );

  const summaryTitle = setupInstalling ? "Installing..." : "";
  const summaryDetail = setupInstalling ? "Setting up Misty components" : "";

  useEffect(() => {
    if (!summaryTitle) {
      setVisibleSummary(null);
      return;
    }
    setVisibleSummary({ title: summaryTitle, detail: summaryDetail });
    const timeout = window.setTimeout(() => {
      setVisibleSummary(null);
    }, workStatusToastDurationMs);
    return () => window.clearTimeout(timeout);
  }, [summaryTitle, summaryDetail]);

  if (!visibleSummary) return null;

  return (
    <Notification
      key={`${visibleSummary.title}:${visibleSummary.detail}`}
      title={visibleSummary.title}
    >
      {visibleSummary.detail}
    </Notification>
  );
});
