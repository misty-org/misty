import { appsApi, type OfficialApp } from "@/api/apps";
import { personalSpaceTemplatesApi } from "@/api/spaces/templates";
import { selectionComplete } from "./SpaceAppSelection";
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
    app_ids: string[];
    app_permissions: Record<string, number>;
  }) => Promise<{ space: { id: string } }>;
  clearError: () => void;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [step, setStep] = useState(0);
  const [templates, setTemplates] = useState<SpaceTemplate[]>([]);
  const [templateId, setTemplateIdValue] = useState("blank");
  const [catalog, setCatalog] = useState<OfficialApp[]>([]);
  const [selectedApps, setSelectedApps] = useState<string[]>([]);
  const [loadError, setLoadError] = useState("");
  const [createError, setCreateError] = useState("");
  const setTemplateId = (id: string) => {
    setTemplateIdValue(id);
    setSelectedApps(templates.find((template) => template.id === id)?.app_ids ?? []);
  };
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open || templates.length) return;
    let active = true;
    Promise.all([spacesApi.templates(), appsApi.catalog(), personalSpaceTemplatesApi.list()])
      .then(([curated, apps, personal]) => {
        if (!active) return;
        setCatalog(apps.apps);
        setTemplates([
          ...curated.templates,
          ...personal.templates.map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            version: item.version,
            app_ids: item.apps.map((app) => app.app_id),
            personal: true,
            recommended_integrations: [],
            seed_summary: { task_count: 0, note_count: 0, collection_count: 0 },
          })),
        ]);
        setLoadError("");
      })
      .catch((error) => {
        if (active)
          setLoadError(
            error instanceof Error
              ? error.message
              : "Templates could not be loaded. Reopen this dialog to retry.",
          );
      });
    return () => {
      active = false;
    };
  }, [open, templates.length]);

  const resetDraft = () => {
    setCreateError("");
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
    if (
      !trimmed ||
      creating ||
      !selectionComplete(catalog, selectedApps) ||
      step < CREATE_STEP_COUNT - 1
    )
      return;
    setCreating(true);
    setCreateError("");
    try {
      const created = await options.createSpace({
        name: trimmed,
        template_id: templateId,
        integration_providers: [],
        app_ids: selectedApps,
        app_permissions: Object.fromEntries(
          catalog
            .filter((app) => selectedApps.includes(app.id))
            .map((app) => [app.id, app.permission_version]),
        ),
      });
      setOpen(false);
      restoreDocumentInteractivityAfterModalClose();
      resetDraft();
      navigate(`/spaces/${encodeURIComponent(created.space.id)}/home`);
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "The Space could not be created. Try again.",
      );
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
    catalog,
    selectedApps,
    setSelectedApps,
    loadError,
    createError,
    selectionValid: selectionComplete(catalog, selectedApps),
    close,
    start,
    submit,
  };
}
