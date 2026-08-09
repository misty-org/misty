import { IconButton } from "@/shared/ui/icon-button";
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { transferStyles } from "../transferStyles";

export function TransfersBottomBar(props: {
  filtersVisible: boolean;
  detailVisible: boolean;
  onToggleFilters: () => void;
  onToggleDetail: () => void;
}) {
  const LeftIcon = props.filtersVisible ? PanelLeftClose : PanelLeftOpen;
  const RightIcon = props.detailVisible ? PanelRightClose : PanelRightOpen;
  return (
    <footer className={transferStyles.bottomBar}>
      <div className={transferStyles.bottomBarSide}>
        <IconButton
          label={props.filtersVisible ? "Hide filters" : "Show filters"}
          size="sm"
          tooltip={false}
          variant={props.filtersVisible ? "secondary" : "ghost"}
          onClick={props.onToggleFilters}
        >
          <LeftIcon />
        </IconButton>
      </div>
      <div className={transferStyles.bottomBarSide}>
        <IconButton
          label={props.detailVisible ? "Hide details" : "Show details"}
          size="sm"
          tooltip={false}
          variant={props.detailVisible ? "secondary" : "ghost"}
          onClick={props.onToggleDetail}
        >
          <RightIcon />
        </IconButton>
      </div>
    </footer>
  );
}
