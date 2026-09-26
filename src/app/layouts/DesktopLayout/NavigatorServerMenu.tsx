import mistyLogo from "@/assets/branding/misty-white.png";
import { useAppStore } from "@/features/app-shell";
import {
  applyDeployment,
  deploymentHostLabel,
  readKnownDeployments,
  type DeploymentChange,
} from "@/features/deployment";
import { useSettingsStore } from "@/features/settings";
import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  NavigationChevron,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Button,
} from "@/shared/ui";
import { Cloud, Plus, Server } from "lucide-react";
import { useState } from "react";
import { navigatorHierarchyTriggerClass } from "./styles";

export function NavigatorServerMenu(props: { onSettingsClick: () => void }) {
  const environment = useAppStore((state) => state.app?.environment);
  const selfHosted = environment?.serverMode === "self_hosted";
  const currentUrl = selfHosted ? (environment.serverUrl ?? "") : "";
  const currentName = selfHosted
    ? environment.serverName?.trim() || deploymentHostLabel(currentUrl) || "Self-hosted"
    : "Hosted";
  const [open, setOpen] = useState(false);
  const [servers, setServers] = useState(readKnownDeployments);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState("");
  const nativeAvailable = hasTauriInternals();
  const knownServers =
    selfHosted && currentUrl && !servers.some((server) => server.url === currentUrl)
      ? [{ url: currentUrl, name: currentName }, ...servers]
      : servers;

  const switchTo = async (target: DeploymentChange) => {
    if (switching || !nativeAvailable) return;
    setSwitching(true);
    setError("");
    try {
      await applyDeployment(target);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change the Misty server.");
      setSwitching(false);
    }
  };

  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) setServers(readKnownDeployments());
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={`${navigatorHierarchyTriggerClass} w-fit max-w-full`}
          aria-label={`Misty server menu, current server: ${currentName}`}
          data-misty-window-drag-block="true"
        >
          <img
            src={mistyLogo}
            alt=""
            aria-hidden="true"
            className="block size-[var(--misty-navigation-icon-size)] shrink-0 object-contain"
          />
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="text-[length:calc(var(--navigation-row-font-size,14px)+2px)] font-semibold tracking-[-0.015em] text-inherit">
              Misty
            </span>
            <NavigationChevron open={open} />
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[240px]" aria-label="Misty servers">
        <DropdownMenuLabel>Server · {currentName}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={selfHosted ? currentUrl : "hosted"}>
          <DropdownMenuRadioItem
            value="hosted"
            indicator="check"
            disabled={switching || !nativeAvailable}
            onSelect={(event) => {
              if (!selfHosted) return;
              event.preventDefault();
              void switchTo({ mode: "hosted" });
            }}
          >
            <Cloud aria-hidden="true" />
            Misty Hosted
          </DropdownMenuRadioItem>
          {knownServers.map((server) => (
            <DropdownMenuRadioItem
              key={server.url}
              value={server.url}
              indicator="check"
              disabled={switching || !nativeAvailable}
              onSelect={(event) => {
                if (selfHosted && currentUrl === server.url) return;
                event.preventDefault();
                void switchTo({ mode: "self_hosted", url: server.url });
              }}
            >
              <Server aria-hidden="true" />
              <span className="min-w-0 truncate" title={server.url}>
                {server.name || deploymentHostLabel(server.url)}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={switching}
          onSelect={() => {
            useSettingsStore.getState().setActiveSection("server");
            props.onSettingsClick();
          }}
        >
          <Plus aria-hidden="true" />
          Connect another server…
        </DropdownMenuItem>
        <p className="px-2 py-1 text-xs text-cream-muted" role="status">
          {switching
            ? "Connecting… Misty will restart."
            : nativeAvailable
              ? "Changing servers restarts Misty."
              : "Switch servers in the Misty desktop app."}
        </p>
        {error ? (
          <p className="px-2 py-1 text-xs text-cream" role="alert">
            {error}
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
