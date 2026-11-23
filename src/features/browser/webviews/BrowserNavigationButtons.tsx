import { IconButton } from "@misty/ui";
import { ArrowLeft, ArrowRight, RotateCw, X } from "lucide-react";
import { browserToolbarStyles } from "./browser_toolbar_styles";

export function BrowserNavigationButtons(props: {
  canGoBack: boolean;
  canGoForward: boolean;
  showStop: boolean;
  reloadDisabled: boolean;
  onTravel(direction: -1 | 1): void;
  onStop?: () => void;
  onReload(): void;
}) {
  return (
    <div className={browserToolbarStyles.group}>
      <IconButton label="Back" disabled={!props.canGoBack} onClick={() => props.onTravel(-1)}>
        <ArrowLeft />
      </IconButton>
      <IconButton label="Forward" disabled={!props.canGoForward} onClick={() => props.onTravel(1)}>
        <ArrowRight />
      </IconButton>
      <IconButton
        label={props.showStop ? "Stop loading" : "Reload"}
        disabled={!props.showStop && props.reloadDisabled}
        onClick={props.showStop ? props.onStop : props.onReload}
      >
        {props.showStop ? <X /> : <RotateCw {...browserToolbarStyles.roundIcon} />}
      </IconButton>
    </div>
  );
}
