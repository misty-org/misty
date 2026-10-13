import { personalSpaceTemplatesApi } from "@/api/spaces/templates";
import { reportSystemError } from "@/features/support/systemErrors";
import { useAppStore } from "@/features/app-shell";
import { spacesApi } from "@/api/spaces/api";
import type {
  CreateSpaceRequest,
  CreateSpaceResult,
  Space,
  SpacePerson,
  SpaceTemplate,
} from "@/api/spaces/dto/entities";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { restoreDocumentInteractivityAfterModalClose } from "./spacesShellStorage";
import { blankTemplate } from "./templateIcons";

export type CreateSpaceTab = "templates" | "mine";

/**
 * The one-screen "Create a Space" flow. Built-in templates, saved templates and
 * people load independently each time it opens; a failure in any of them never
 * blocks creating a Space, and Blank is always offered.
 */
export function useCreateSpaceDialog(options: {
  createSpace: (input: CreateSpaceRequest) => Promise<CreateSpaceResult>;
  clearError: () => void;
  spaces: Space[];
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<CreateSpaceTab>("templates");
  const [name, setName] = useState("");
  const [curated, setCurated] = useState<SpaceTemplate[]>();
  const [curatedFailed, setCuratedFailed] = useState(false);
  const [personal, setPersonal] = useState<SpaceTemplate[]>();
  const [personalFailed, setPersonalFailed] = useState(false);
  const [people, setPeople] = useState<SpacePerson[]>([]);
  const [template, setTemplate] = useState<SpaceTemplate | undefined>(blankTemplate);
  const [sourceSpace, setSourceSpace] = useState<Space>();
  const [invites, setInvites] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  useEffect(() => {
    if (!open) return;
    let active = true;
    // Earlier results stay on screen while these refresh.
    void Promise.allSettled([
      spacesApi.templates(),
      personalSpaceTemplatesApi.list(),
      personalSpaceTemplatesApi.people(),
    ]).then(([curatedResult, personalResult, peopleResult]) => {
      if (!active) return;
      if (curatedResult.status === "fulfilled") {
        setCurated(curatedResult.value.templates);
        setCuratedFailed(false);
      } else setCuratedFailed(true);
      if (personalResult.status === "fulfilled") {
        setPersonal(personalResult.value.templates);
        setPersonalFailed(false);
      } else setPersonalFailed(true);
      if (peopleResult.status === "fulfilled") setPeople(peopleResult.value.people);
    });
    return () => {
      active = false;
    };
  }, [open]);

  /** The current suggestion, which the name follows until the person types their own. */
  const suggestedName = sourceSpace ? sourceSpace.name : (template?.suggested_name ?? "");
  const followSuggestion = (next: string) => {
    if (!name.trim() || name === suggestedName) setName(next);
  };
  const chooseTemplate = (next: SpaceTemplate) => {
    followSuggestion(next.suggested_name);
    setTemplate(next);
    setSourceSpace(undefined);
  };
  const copySpace = (space: Space) => {
    followSuggestion(space.name);
    setSourceSpace(space);
    setTemplate(undefined);
  };

  const resetDraft = () => {
    setCreateError("");
    setName("");
    setTab("templates");
    setTemplate(blankTemplate);
    setSourceSpace(undefined);
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
    if (!trimmed || creating || (!template && !sourceSpace)) return;
    setCreating(true);
    setCreateError("");
    const pendingInvites = invites;
    let created: CreateSpaceResult;
    try {
      created = await options.createSpace({
        name: trimmed,
        template_id: sourceSpace ? "" : (template?.id ?? blankTemplate.id),
        ...(sourceSpace ? { source_space_id: sourceSpace.id } : {}),
        integration_providers: [],
      });
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
    navigate(`/spaces/${encodeURIComponent(created.space.id)}/home`);
    const sent = await Promise.allSettled(
      pendingInvites.map((email) => spacesApi.invite(created.space.id, email)),
    );
    const unsent = sent.filter((result) => result.status === "rejected").length;
    const notes = [
      created.seed_incomplete ? "Some starter notes couldn't be added." : "",
      unsent
        ? `${unsent} invitation${unsent === 1 ? "" : "s"} couldn't be sent. Invite them from Members.`
        : "",
    ].filter(Boolean);
    if (notes.length) useAppStore.getState().setMessage(`Space created. ${notes.join(" ")}`);
  };

  return {
    open,
    setOpen,
    tab,
    setTab,
    name,
    setName,
    curated: curated ?? (curatedFailed ? [blankTemplate] : undefined),
    curatedFailed,
    personal,
    personalFailed,
    people,
    spaces: options.spaces,
    template,
    sourceSpace,
    chooseTemplate,
    copySpace,
    invites,
    setInvites,
    creating,
    createError,
    close,
    start,
    submit,
  };
}
