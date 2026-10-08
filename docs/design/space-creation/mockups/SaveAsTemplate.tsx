import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
} from "@/shared/ui";

const parts = [
  ["Channels", "Everyone, Launch", true],
  ["Task titles", "4 tasks, without assignees or dates", true],
  ["Note outlines", "Headings from Launch checklist", true],
  ["Collection names", "Press kit, Screenshots", true],
  ["Files and messages", "Never copied", false],
] as const;

/** Space settings → Save as template: the structure is captured, never the content. */
export function SaveAsTemplate() {
  return (
    <Dialog open>
      <DialogContent aria-describedby="save-template-description" className="max-w-md">
        <DialogHeader>
          <DialogTitle>Save as template</DialogTitle>
          <DialogDescription id="save-template-description">
            Start future Spaces with Launch room's structure. Only you can use this template.
          </DialogDescription>
        </DialogHeader>
        <label className="grid gap-2 text-xs font-medium text-cream-muted">
          Name
          <Input defaultValue="Studio launch" />
        </label>
        <label className="grid gap-2 text-xs font-medium text-cream-muted">
          Description
          <Textarea rows={2} defaultValue="Our launch checklist, channels and press kit." />
        </label>
        <div className="grid gap-2.5">
          <p className="m-0 text-xs font-medium text-cream-muted">Includes</p>
          {parts.map(([label, detail, included]) => (
            <label key={label} className="flex items-start gap-2.5 text-sm">
              <Checkbox
                className="mt-0.5"
                defaultChecked={included}
                disabled={!included}
                aria-label={label}
              />
              <span className="grid">
                <span className={included ? "text-cream" : "text-cream-muted"}>{label}</span>
                <span className="text-xs text-cream-muted">{detail}</span>
              </span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline">Cancel</Button>
          <Button>Save template</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
