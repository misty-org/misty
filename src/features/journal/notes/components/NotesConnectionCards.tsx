import { SystemErrorActivity } from "@/features/activity";

export function SyncErrorNotice(props: { message: string; onRetry?: () => void }) {
  return (
    <SystemErrorActivity
      error={props.message}
      scope="notes:sync"
      title="Notes could not be synchronized"
    />
  );
}
