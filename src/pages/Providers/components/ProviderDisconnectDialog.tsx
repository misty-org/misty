import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { iconAssets } from "../../../shared/assets/icons";
import { AssetIcon } from "../../../shared/components/AssetIcon";

export function ProviderDisconnectDialog(props: {
  remoteName: string;
  working: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) props.onCancel(); }}>
      <DialogContent className="max-w-md bg-popover">
        <DialogHeader>
          <DialogTitle>Delete Remote?</DialogTitle>
          <DialogDescription>
            <strong className="font-semibold text-foreground">{props.remoteName}</strong> will be removed from Misty and rclone. Files stored by the provider will not be deleted.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" type="button" onClick={props.onCancel} disabled={props.working}>Cancel</Button>
          <Button variant="destructive" type="button" onClick={props.onConfirm} disabled={props.working}>
            <AssetIcon src={iconAssets.trash24} size={16} />
            {props.working ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
