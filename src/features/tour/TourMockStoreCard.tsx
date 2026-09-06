import { Badge, Button } from "@/shared/ui";
import { Check, DownloadCloud, Sparkles } from "lucide-react";
import { useTourStore } from "./useTourStore";

interface MockStoreApp {
  id: string;
  name: string;
  category: string;
  description: string;
}

const MOCK_STORE_APPS: MockStoreApp[] = [
  {
    id: "github-assistant",
    name: "GitHub Assistant",
    category: "Developer Tools",
    description: "Connect pull requests, issues, and diff reviews into your workspace.",
  },
  {
    id: "figma-preview",
    name: "Figma Connect",
    category: "Design",
    description: "Embed live design frames directly into Space canvas panes.",
  },
];

export function TourMockStoreCard() {
  const mockInstalledApps = useTourStore((state) => state.mockInstalledApps);
  const toggleMockInstall = useTourStore((state) => state.toggleMockInstall);

  return (
    <div
      className="rounded-lg border border-charcoal-border bg-charcoal-bg/90 p-3.5"
      data-tour-target="store-catalog"
    >
      <div className="flex items-center justify-between pb-2.5 border-b border-charcoal-border/70">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-cream-bright">
          <Sparkles size={14} className="text-cream-muted" />
          <span>Interactive Store Preview</span>
        </div>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 font-normal text-cream-muted border-charcoal-border">
          Sandbox mode
        </Badge>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-cream-muted">
        Try clicking <strong className="text-cream font-medium">Install</strong> below to see how extensions dock into your workspace without downloading real files:
      </p>

      <div className="mt-2.5 space-y-2">
        {MOCK_STORE_APPS.map((app) => {
          const isInstalled = mockInstalledApps.includes(app.id);
          return (
            <div
              key={app.id}
              className="flex items-center justify-between gap-3 rounded-md border border-charcoal-border bg-charcoal-card p-2.5 transition-colors"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-cream-bright truncate">{app.name}</span>
                  <span className="text-[10px] text-cream-muted">({app.category})</span>
                </div>
                <p className="text-[11px] text-cream-muted truncate mt-0.5">{app.description}</p>
              </div>

              <Button
                type="button"
                variant={isInstalled ? "secondary" : "default"}
                size="xs"
                className="shrink-0 h-7 text-xs px-2.5 gap-1"
                onClick={() => toggleMockInstall(app.id)}
              >
                {isInstalled ? (
                  <>
                    <Check size={12} className="text-cream" />
                    <span>Installed</span>
                  </>
                ) : (
                  <>
                    <DownloadCloud size={12} />
                    <span>Install</span>
                  </>
                )}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
