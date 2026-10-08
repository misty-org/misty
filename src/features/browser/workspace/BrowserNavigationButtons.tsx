import { IconButton, toolbarIconProps } from "@/shared/ui";
import { ArrowLeft, ArrowRight, RotateCw, X } from "lucide-react";
import { browserToolbarStyles } from "./browserToolbarStyles";
import { useHiddenToolbarButtons } from "@/features/settings/browserToolbarButtons";

/** Back, forward and reload (or stop while loading) at the start of the toolbar. */
export function BrowserNavigationButtons(props: {
  canGoBack: boolean;
  canGoForward: boolean;
  /** The page is loading and can be stopped. */
  showStop: boolean;
  reloadDisabled: boolean;
  onTravel(direction: -1 | 1): void;
  onStop?: () => void;
  onReload(): void;
}) {
  const hiddenButtons = useHiddenToolbarButtons();
  return (
    <div className={browserToolbarStyles.group}>
      <IconButton
        label="Back"
        tooltip={false}
        disabled={!props.canGoBack}
        onClick={() => props.onTravel(-1)}
      >
        <ArrowLeft {...toolbarIconProps} />
      </IconButton>
      {hiddenButtons.has("forward") ? null : (
        <IconButton
          label="Forward"
          tooltip={false}
          disabled={!props.canGoForward}
          onClick={() => props.onTravel(1)}
        >
          <ArrowRight {...toolbarIconProps} />
        </IconButton>
      )}
      {hiddenButtons.has("reload") && !props.showStop ? null : (
        <IconButton
          label={props.showStop ? "Stop loading" : "Reload"}
          tooltip={false}
          disabled={!props.showStop && props.reloadDisabled}
          onClick={props.showStop ? props.onStop : props.onReload}
        >
          {props.showStop ? (
            <X {...toolbarIconProps} />
          ) : (
            <RotateCw {...browserToolbarStyles.roundIcon} />
          )}
        </IconButton>
      )}
    </div>
  );
}
