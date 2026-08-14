import { Button, ErrorState, LoadingScreen } from "@/shared/ui";

export function SpacePageLoadingPlaceholder(props: { label?: string; onRetry?: () => void }) {
  // These callers supply retry only after a request has failed.
  if (props.onRetry) {
    return (
      <ErrorState
        className="h-full"
        title="Spaces could not be loaded"
        action={<Button onClick={props.onRetry}>Try again</Button>}
      />
    );
  }
  return <LoadingScreen label={props.label ?? "Loading Space"} />;
}
