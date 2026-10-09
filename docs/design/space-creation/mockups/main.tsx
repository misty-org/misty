import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "@/styles/styles.css";
import "@/styles/App.css";
import "./preview.css";
import { CreateSpaceDialog } from "@/features/spaces/spacesShell/CreateSpaceDialog";
import type { useCreateSpaceDialog } from "@/features/spaces/spacesShell/useCreateSpaceDialog";
import type { SpaceTemplate } from "@/api/spaces/dto/interfaces/types";
import { TooltipProvider } from "@/shared/ui";
import { builtInTemplates } from "./data";
import { ProposedCreateSpace, type ProposedState } from "./ProposedCreateSpace";
import { SaveAsTemplate } from "./SaveAsTemplate";

const params = new URLSearchParams(location.search);
const view = params.get("view") ?? "proposed";
const state = (params.get("state") ?? "default") as ProposedState;

/** Today's dialog, rendered from the production component with a fixture hook result. */
function Current({ step }: { step: number }) {
  const templates: SpaceTemplate[] = builtInTemplates
    .filter((template) => !template.proposed)
    .map((template) => ({
      id: template.id,
      name: template.id === "blank" ? "Blank Space" : template.name,
      description: template.description,
      version: 1,
      recommended_integrations: [],
      seed_summary: { task_count: 0, note_count: 0, collection_count: 0 },
    }));
  const noop = () => undefined;
  const dialog = {
    open: true,
    setOpen: noop,
    name: step ? "Launch room" : "",
    setName: noop,
    step,
    setStep: noop,
    templates,
    templateId: "startup",
    setTemplateId: noop,
    creating: false,
    loadError: "",
    createError: "",
    close: noop,
    start: noop,
    submit: async () => undefined,
  } as unknown as ReturnType<typeof useCreateSpaceDialog>;
  return <CreateSpaceDialog dialog={dialog} />;
}

function Preview() {
  if (view === "current-name") return <Current step={0} />;
  if (view === "current-template") return <Current step={1} />;
  if (view === "save-template") return <SaveAsTemplate />;
  return <ProposedCreateSpace state={state} />;
}

createRoot(document.getElementById("root")!).render(
  <MemoryRouter>
    <TooltipProvider>
      <div className="preview-backdrop" aria-hidden="true">
        <div className="preview-rail" />
        <div className="preview-pane" />
      </div>
      <Preview />
    </TooltipProvider>
  </MemoryRouter>,
);
