import { useState } from "react";
import { Plus, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../components/ui/alert-dialog";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import type { SavedSearchRule } from "@/services/misty-api/types";
import type {
  SmartFolderDialogState,
  SmartFolderDraft,
  WorkspaceDialogState,
} from "./ExplorerSidebarSupport";
import { smartFolderQueryFromRules } from "./ExplorerSidebarQuery";

const smartFolderFields = [
  { value: "text", label: "Text query" },
  { value: "path", label: "Path / source" },
  { value: "kind", label: "File or folder" },
  { value: "extension", label: "Extension" },
  { value: "size", label: "Size" },
  { value: "modified", label: "Modified date" },
  { value: "hidden", label: "Hidden" },
  { value: "tag", label: "Misty tag" },
] as const;

const smartFolderOperators = [
  { value: "contains", label: "contains" },
  { value: "is", label: "is" },
  { value: "is_not", label: "is not" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
  { value: "gt", label: "greater than" },
  { value: "lt", label: "less than" },
  { value: "after", label: "after" },
  { value: "before", label: "before" },
] as const;

const fieldClass = "grid gap-1.5";
const fieldLabelClass = "text-xs font-medium text-muted-foreground";

export function WorkspaceDialog(props: {
  state: NonNullable<WorkspaceDialogState>;
  value: string;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (props.state.kind === "delete") {
    return (
      <AlertDialog
        open
        onOpenChange={(open) => {
          if (!open) props.onCancel();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Workspace</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <strong className="font-medium text-foreground">{props.state.title}</strong>?
              This removes the saved layout, not any files.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={props.onConfirm}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  const title = props.state.kind === "create" ? "New Workspace" : "Rename Workspace";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            props.onConfirm();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>Give this Explorer pane arrangement a clear name.</DialogDescription>
          </DialogHeader>
          <div className={fieldClass}>
            <Label className={fieldLabelClass} htmlFor="workspace-name">
              Name
            </Label>
            <Input
              id="workspace-name"
              autoFocus
              value={props.value}
              onChange={(event) => props.onChange(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={props.onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={!props.value.trim()}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SmartFolderDialog(props: {
  state: NonNullable<SmartFolderDialogState>;
  error: string | null;
  onSave: (draft: SmartFolderDraft) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<SmartFolderDraft>(props.state.draft);
  const editing = Boolean(draft.id);
  const updateRule = (index: number, patch: Partial<SavedSearchRule>) => {
    setDraft((current) => ({
      ...current,
      rules: current.rules.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...patch } : rule,
      ),
    }));
  };
  const addRule = () =>
    setDraft((current) => ({
      ...current,
      rules: [...current.rules, defaultSmartFolderRule()],
    }));
  const removeRule = (index: number) =>
    setDraft((current) => ({
      ...current,
      rules:
        current.rules.length <= 1
          ? [defaultSmartFolderRule()]
          : current.rules.filter((_rule, ruleIndex) => ruleIndex !== index),
    }));

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
    >
      <DialogContent className="max-h-[min(720px,calc(100vh-48px))] overflow-y-auto sm:max-w-2xl">
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void props.onSave(draft);
          }}
        >
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Collection" : "New Collection"}</DialogTitle>
            <DialogDescription>
              Build a reusable Explorer view from a query and structured rules.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className={fieldClass}>
              <Label className={fieldLabelClass} htmlFor="smart-folder-name">
                Name
              </Label>
              <Input
                id="smart-folder-name"
                autoFocus
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
              />
            </div>
            <div className={fieldClass}>
              <Label className={fieldLabelClass} htmlFor="smart-folder-match">
                Match
              </Label>
              <Select
                value={draft.matchMode}
                onValueChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    matchMode: value === "any" ? "any" : "all",
                  }))
                }
              >
                <SelectTrigger id="smart-folder-match">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All rules</SelectItem>
                  <SelectItem value="any">Any rule</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className={fieldClass}>
            <Label className={fieldLabelClass} htmlFor="smart-folder-query">
              Query string
            </Label>
            <Input
              id="smart-folder-query"
              value={draft.query}
              placeholder={
                smartFolderQueryFromRules(draft.rules, draft.matchMode) || "invoice pdf tag:work"
              }
              onChange={(event) =>
                setDraft((current) => ({ ...current, query: event.target.value }))
              }
            />
          </div>

          <div className="grid gap-2 rounded-lg bg-muted/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-muted-foreground">Rules</span>
              <Button variant="ghost" size="sm" type="button" onClick={addRule}>
                <Plus size={14} /> Add rule
              </Button>
            </div>
            {draft.rules.map((rule, index) => (
              <div
                className="grid gap-2 border-t border-border/70 pt-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1.2fr)_32px]"
                key={`rule:${index}`}
              >
                <Select
                  value={rule.field}
                  onValueChange={(value) => updateRule(index, { field: value })}
                >
                  <SelectTrigger aria-label={`Rule ${index + 1} field`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {smartFolderFields.map((field) => (
                      <SelectItem key={field.value} value={field.value}>
                        {field.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={rule.operator}
                  onValueChange={(value) => updateRule(index, { operator: value })}
                >
                  <SelectTrigger aria-label={`Rule ${index + 1} operator`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {smartFolderOperators.map((operator) => (
                      <SelectItem key={operator.value} value={operator.value}>
                        {operator.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={rule.value}
                  placeholder={smartFolderValuePlaceholder(rule.field)}
                  onChange={(event) => updateRule(index, { value: event.target.value })}
                  aria-label={`Rule ${index + 1} value`}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  aria-label={`Remove rule ${index + 1}`}
                  onClick={() => removeRule(index)}
                >
                  <X size={15} />
                </Button>
              </div>
            ))}
          </div>

          {props.error ? (
            <p className="m-0 text-sm text-destructive" role="alert">
              {props.error}
            </p>
          ) : null}
          <DialogFooter className="sm:justify-between">
            <div>
              {editing ? (
                <Button
                  variant="destructive"
                  type="button"
                  onClick={() => void props.onDelete(draft.id)}
                >
                  Delete
                </Button>
              ) : null}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" type="button" onClick={props.onCancel}>
                Cancel
              </Button>
              <Button type="submit" disabled={!draft.name.trim()}>
                Save
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeviceDialog(props: {
  title: string;
  label: string;
  placeholder?: string;
  value: string;
  confirmLabel: string;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const inputId = `device-dialog-${props.title.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            props.onConfirm();
          }}
        >
          <DialogHeader>
            <DialogTitle>{props.title}</DialogTitle>
            <DialogDescription>Update the drive entry shown in Explorer.</DialogDescription>
          </DialogHeader>
          <div className={fieldClass}>
            <Label className={fieldLabelClass} htmlFor={inputId}>
              {props.label}
            </Label>
            <Input
              id={inputId}
              autoFocus
              value={props.value}
              placeholder={props.placeholder}
              onChange={(event) => props.onChange(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={props.onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={!props.value.trim()}>
              {props.confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function defaultSmartFolderRule(): SavedSearchRule {
  return { field: "text", operator: "contains", value: "" };
}

function smartFolderValuePlaceholder(field: string): string {
  switch (field) {
    case "path":
      return "/Users/name/Documents or remote:";
    case "kind":
      return "file or folder";
    case "extension":
      return "pdf";
    case "size":
      return "10MB";
    case "modified":
      return "2026-06-01";
    case "hidden":
      return "true or false";
    case "tag":
      return "work";
    default:
      return "invoice";
  }
}
