import { reportSystemError } from "@/features/activity";
import { spacesApi } from "@/api/spaces/api";
import type { SpaceIntegrationProvider, SpaceTemplate } from "@/api/spaces/dto/interfaces/types";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { restoreDocumentInteractivityAfterModalClose } from "./spacesShellStorage";

export const CREATE_STEP_COUNT = 2;

/**
 * The focused two-step "Create a Space" flow: name, then template.
 *
 * Templates load lazily the first time the dialog opens, and a failure there is
 * non-fatal — a Blank Space is always offered as a fallback.
 */
export function useCreateSpaceDialog(options: {
  createSpace: (input: {
    name: string;
    template_id: string;
    integration_providers: SpaceIntegrationProvider[];
  }) => Promise<{ space: { id: string } }>;
  clearError: () => void;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [step, setStep] = useState(0);
  const [templates, setTemplates] = useState<SpaceTemplate[]>([]);
  const [templateId, setTemplateId] = useState("blank");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open || templates.length) return;
    let active = true;
    spacesApi
      .templates()
      .then(({ templates: loaded }) => {
        if (!active) return;
        setTemplates(loaded);
      })
      .catch((error) => {
        if (active) {
          reportSystemError({
            error,
            scope: "spaces:create:templates",
            title: "Space templates could not be loaded",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [open, templates.length]);

  const resetDraft = () => {
    setName("");
    setStep(0);
    setTemplateId("blank");
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
    if (!trimmed || creating || step < CREATE_STEP_COUNT - 1) return;
    setCreating(true);
    try {
      const created = await options.createSpace({
        name: trimmed,
        template_id: templateId,
        integration_providers: [],
      });
      setOpen(false);
      restoreDocumentInteractivityAfterModalClose();
      resetDraft();
      navigate(`/spaces/${encodeURIComponent(created.space.id)}/home`);
    } catch (error) {
      reportSystemError({
        error,
        scope: "spaces:create",
        title: "Space could not be created",
      });
    } finally {
      setCreating(false);
    }
  };

  return {
    open,
    setOpen,
    name,
    setName,
    step,
    setStep,
    templates,
    templateId,
    setTemplateId,
    creating,
    close,
    start,
    submit,
  };
}
