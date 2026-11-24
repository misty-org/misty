import {
  Button,
  CopyButton,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@misty/ui";

export interface ShownToken {
  name: string;
  token: string;
}

export function IntegrationTokenDialog(props: {
  shown: ShownToken | null;
  onClose: () => void;
}) {
  const { shown } = props;
  return (
    <Dialog open={shown !== null} onOpenChange={(next) => (next ? undefined : props.onClose())}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{`Token for ${shown?.name ?? ""}`}</DialogTitle>
          <DialogDescription>Copy it now. Misty won't show it again.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex min-w-0 items-center gap-2">
            <Input
              readOnly
              aria-label="Token"
              value={shown?.token ?? ""}
              onFocus={(event) => event.currentTarget.select()}
            />
            <CopyButton label="Copy token" value={shown?.token ?? ""} />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="primary" size="lg" onClick={props.onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
