import { reportSystemError } from "@/features/support/systemErrors";
import { useAppStore } from "@/features/app-shell";
import { spacesApi } from "@/api/spaces/api";
import type { CreateSpaceRequest, CreateSpaceResult, SpacePerson } from "@/api/spaces/dto/entities";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { restoreDocumentInteractivityAfterModalClose } from "./spacesShellStorage";

/**
 * "Create a Space": a name and, optionally, people to invite. Every Space
 * starts empty. People load each time it opens; a failure never blocks creating.
 */
export function useCreateSpaceDialog(options: {
  createSpace: (input: CreateSpaceRequest) => Promise<CreateSpaceResult>;
  clearError: () => void;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [people, setPeople] = useState<SpacePerson[]>([]);
  const [invites, setInvites] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  useEffect(() => {
    if (!open) return;
    let active = true;
    // Earlier results stay on screen while these refresh.
    void spacesApi.people().then(
      (result) => {
        if (active) setPeople(result.people);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [open]);

  const resetDraft = () => {
    setCreateError("");
    setName("");
    setInvites([]);
  };

  const close = () => {
    if (creating) return;
    options.clearError();
    setOpen(false);
    restoreDocumentInteractivityAfterModalClose();
    resetDraft();
  };

  const start = () => {
    options.clearError();
    setOpen(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setCreateError("");
    const pendingInvites = invites;
    let created: CreateSpaceResult;
    try {
      created = await options.createSpace({ name: trimmed });
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "The Space wasn't created. Try again.",
      );
      reportSystemError({ error, scope: "spaces:create", title: "Space could not be created" });
      setCreating(false);
      return;
    }
    setCreating(false);
    setOpen(false);
    restoreDocumentInteractivityAfterModalClose();
    resetDraft();
    navigate(`/spaces/${encodeURIComponent(created.space.id)}/chat`);
    const sent = await Promise.allSettled(
      pendingInvites.map((email) => spacesApi.invite(created.space.id, email)),
    );
    const unsent = sent.filter((result) => result.status === "rejected").length;
    if (unsent) {
      useAppStore
        .getState()
        .setMessage(
          `Space created. ${unsent} invitation${unsent === 1 ? "" : "s"} couldn't be sent. Invite them from Members.`,
        );
    }
  };

  return {
    open,
    setOpen,
    name,
    setName,
    people,
    invites,
    setInvites,
    creating,
    createError,
    close,
    start,
    submit,
  };
}
