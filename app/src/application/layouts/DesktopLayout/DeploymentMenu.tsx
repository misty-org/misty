import { useAppStore } from "@/features/app-shell";
import {
  applyDeployment,
  deploymentHostLabel,
  forgetDeployment,
  readKnownDeployments,
  type KnownDeployment,
} from "@/features/deployment";
import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from "@/shared/ui";
import { Check, ChevronDown, Cloud, Loader2, Plus, Server, X } from "lucide-react";
import { useState } from "react";

export function DeploymentMenu(props: {
  collapsed: boolean;
  mistyLogoSource: string | null;
  onConnectServer: () => void;
}) {
  const environment = useAppStore((state) => state.app?.environment);
  const [servers, setServers] = useState<KnownDeployment[]>(() =>
    hasTauriInternals() ? readKnownDeployments() : [],
  );
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  const brand = <Brand collapsed={props.collapsed} mistyLogoSource={props.mistyLogoSource} />;
  // The web build has no native configuration to rewrite and cannot restart
  // itself, so the wordmark stays a plain wordmark there.
  if (!hasTauriInternals() || !environment) return brand;

  const selfHosted = environment.serverMode === "self_hosted";
  const currentUrl = selfHosted ? (environment.serverUrl ?? "") : "";
  const currentLabel = selfHosted
    ? environment.serverName?.trim() || deploymentHostLabel(currentUrl)
    : "Misty Hosted";

  const switchTo = async (target: { mode: "hosted" | "self_hosted"; url?: string }) => {
    if (switchingTo) return;
    setSwitchingTo(target.url ?? "hosted");
    try {
      await applyDeployment(target);
    } catch (error: unknown) {
      setSwitchingTo(null);
      useAppStore
        .getState()
        .setError(error instanceof Error ? error.message : "Could not change the Misty server.");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex min-w-0 shrink-0 items-center rounded-md border-0 bg-transparent text-left transition-colors",
            "hover:bg-charcoal-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-charcoal-active",
            props.collapsed ? "mx-auto justify-center p-1" : "gap-2.5 px-2.5 py-1",
          )}
          aria-label={`Misty server: ${currentLabel}`}
          title={currentLabel}
          data-misty-window-drag-block="true"
        >
          {brand}
          {props.collapsed ? null : (
            <ChevronDown size={14} className="shrink-0 text-cream-faint" strokeWidth={2} />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="min-w-[264px]">
        <DropdownMenuLabel>Misty server</DropdownMenuLabel>
        <DeploymentItem
          icon={Cloud}
          name="Misty Hosted"
          detail="Misty’s managed service"
          selected={!selfHosted}
          busy={switchingTo === "hosted"}
          disabled={switchingTo !== null}
          onSelect={() => void switchTo({ mode: "hosted" })}
        />
        {servers.map((server) => (
          <DeploymentItem
            key={server.url}
            icon={Server}
            name={server.name}
            detail={deploymentHostLabel(server.url)}
            selected={selfHosted && server.url === currentUrl}
            busy={switchingTo === server.url}
            disabled={switchingTo !== null}
            onSelect={() => void switchTo({ mode: "self_hosted", url: server.url })}
            onForget={
              selfHosted && server.url === currentUrl
                ? undefined
                : () => setServers(forgetDeployment(server.url))
            }
          />
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={switchingTo !== null} onSelect={props.onConnectServer}>
          <Plus size={14} /> Connect a server…
        </DropdownMenuItem>
        <p className="px-2 py-1.5 text-[11px] text-cream-faint">
          Switching servers restarts Misty. Each server keeps its own local data.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DeploymentItem(props: {
  icon: typeof Cloud;
  name: string;
  detail: string;
  selected: boolean;
  busy: boolean;
  disabled: boolean;
  onSelect: () => void;
  onForget?: () => void;
}) {
  const Icon = props.icon;
  return (
    <DropdownMenuItem
      className="group/deployment items-start gap-2"
      disabled={props.disabled || props.selected}
      onSelect={(event) => {
        if (props.selected) return;
        event.preventDefault();
        props.onSelect();
      }}
    >
      <Icon size={14} className="mt-0.5 shrink-0" />
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-sm">{props.name}</span>
        <span className="truncate text-[11px] text-cream-faint">{props.detail}</span>
      </span>
      {props.busy ? (
        <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin" />
      ) : props.selected ? (
        <Check size={14} className="mt-0.5 shrink-0" />
      ) : props.onForget ? (
        <span
          role="button"
          tabIndex={-1}
          aria-label={`Forget ${props.name}`}
          className="mt-0.5 shrink-0 rounded p-0.5 text-cream-faint opacity-0 hover:text-cream group-hover/deployment:opacity-100"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            props.onForget?.();
          }}
        >
          <X size={13} />
        </span>
      ) : null}
    </DropdownMenuItem>
  );
}

function Brand(props: { collapsed: boolean; mistyLogoSource: string | null }) {
  return (
    <>
      {props.mistyLogoSource ? (
        <img
          className="pointer-events-none size-5 shrink-0 object-contain"
          src={props.mistyLogoSource}
          alt="Misty"
          draggable={false}
        />
      ) : null}
      {props.collapsed ? null : (
        <span className="min-w-0 truncate text-[18px] font-semibold tracking-[-0.02em] text-cream-bright">
          Misty
        </span>
      )}
    </>
  );
}
