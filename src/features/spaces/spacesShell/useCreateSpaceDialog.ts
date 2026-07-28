import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { openExternalLink } from "@/platform/openExternalLink";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type {
  ProviderConnectionAvailability,
  SpaceIntegrationProvider,
  SpaceTemplate,
} from "@/models/interfaces/features/spaces/types";
import { restoreDocumentInteractivityAfterModalClose } from "./spacesShellStorage";

export const CREATE_STEP_COUNT = 3;

/**
 * The three-step "Create a Space" flow: name, template, integrations.
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
  const [providers, setProviders] = useState<SpaceIntegrationProvider[]>([]);
  const [providerAvailability, setProviderAvailability] = useState<
    ProviderConnectionAvailability[]
  >([]);
  const [templateError, setTemplateError] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open || templates.length) return;
    let active = true;
    spacesApi
      .templates()
      .then(({ templates: loaded, providers: available }) => {
        if (!active) return;
        setTemplates(loaded);
        setProviderAvailability(available ?? []);
      })
      .catch(() => {
        if (active)
          setTemplateError("Templates could not be loaded. You can still create a Blank Space.");
      });
    return () => {
      active = false;
    };
  }, [open, templates.length]);

  const resetDraft = () => {
    setName("");
    setStep(0);
    setTemplateId("blank");
    setProviders([]);
  };

  const close = () => {
    if (creating) return;
    options.clearError();
    setOpen(false);
    restoreDocumentInteractivityAfterModalClose();
    resetDraft();
    setProviderAvailability([]);
    setTemplateError("");
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
      const firstProvider = providers[0];
      const created = await options.createSpace({
        name: trimmed,
        template_id: templateId,
        integration_providers: providers,
      });
      setOpen(false);
      restoreDocumentInteractivityAfterModalClose();
      resetDraft();
      navigate(`/spaces/${encodeURIComponent(created.space.id)}/chat?created=1`);
      if (firstProvider) beginProviderConnection(created.space.id, firstProvider);
    } catch {
      /* the dialog renders the store error */
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
    providers,
    setProviders,
    providerAvailability,
    templateError,
    creating,
    close,
    start,
    submit,
  };
}

function beginProviderConnection(spaceId: string, provider: SpaceIntegrationProvider) {
  void spacesApi
    .beginProviderConnection(spaceId, provider, `/spaces/${spaceId}/settings/integrations`)
    .then((start) => openExternalLink(start.authorization_url))
    .catch(() => {
      // The resumable setup card remains available in Chat and Settings.
    });
}
