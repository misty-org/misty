// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { Folder, Globe } from "lucide-react";
import { useState, type FormEvent } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@/shared/ui";
import type { CustomPromptEntry, PromptScope } from "./promptsApi";

export interface PromptEditorValue {
  name: string;
  description?: string;
  argumentHint?: string;
  content: string;
  /** Only when creating: an edit keeps the file's scope (the row's menu moves it). */
  scope: PromptScope;
}

/**
 * Creates or edits one prompt (a Markdown file with front matter). The section owns the change;
 * this dialog collects the fields and hands them over trimmed. The scope is chosen only when
 * creating, and only when the chat has a linked folder to keep it in.
 */
export function PromptEditorDialog({
  initial,
  initialScope,
  folderAvailable,
  onSubmit,
  onCancel,
}: {
  /** Present when editing; absent creates a new prompt. */
  initial?: CustomPromptEntry;
  initialScope: PromptScope;
  folderAvailable: boolean;
  onSubmit: (value: PromptEditorValue) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [argumentHint, setArgumentHint] = useState(initial?.argumentHint ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [scope, setScope] = useState<PromptScope>(
    initial?.scope ?? (folderAvailable ? initialScope : "global"),
  );

  const trimmedName = name.trim();
  const nameInvalid = /[\s/\\]/.test(trimmedName);
  const valid = trimmedName.length > 0 && !nameInvalid && content.trim().length > 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    onSubmit({
      name: trimmedName,
      description: description.trim() || undefined,
      argumentHint: argumentHint.trim() || undefined,
      content,
      scope,
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent aria-describedby={undefined} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit prompt" : "New prompt"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
            <Field
              label="Name"
              error={nameInvalid ? "Use a name without spaces or slashes." : undefined}
            >
              <Input
                value={name}
                placeholder="review"
                maxLength={120}
                autoFocus
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            {!initial && folderAvailable ? (
              <Field label="Scope">
                <Select
                  value={scope}
                  onValueChange={(value) => setScope(value === "global" ? "global" : "workspace")}
                >
                  <SelectTrigger aria-label="Scope" className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="workspace" icon={Folder} label="This folder" />
                    <SelectItem value="global" icon={Globe} label="Everywhere" />
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
          </div>
          <Field label="Description">
            <Input
              value={description}
              placeholder="What it's for"
              maxLength={300}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <Field label="Argument hint">
            <Input
              value={argumentHint}
              placeholder="<file path>"
              maxLength={200}
              onChange={(event) => setArgumentHint(event.target.value)}
            />
          </Field>
          <Field label="Prompt">
            <Textarea
              value={content}
              rows={10}
              placeholder="The prompt; $ARGUMENTS stands for what you type after it"
              className="font-mono text-sm"
              onChange={(event) => setContent(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button size="lg" type="button" onClick={onCancel}>
              Cancel
            </Button>
            <Button size="lg" type="submit" disabled={!valid}>
              {initial ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
