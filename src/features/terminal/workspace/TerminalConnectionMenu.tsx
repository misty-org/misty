import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/shared/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { Check, ChevronDown, CornerDownLeft, Laptop, Server } from "lucide-react";
import { useMemo, useState } from "react";
import {
  localTerminalEnvironment,
  resolveSshConnectionInput,
  sshEnvironmentSummary,
  terminalEnvironmentIdentity,
  type SshEnvironment,
  type TerminalEnvironment,
} from "./sshEnvironments";

interface TerminalConnectionMenuProps {
  environment: TerminalEnvironment;
  environments: SshEnvironment[];
  loadError?: string;
  disabled?: boolean;
  onSelect: (environment: TerminalEnvironment) => void;
}

export function TerminalConnectionMenu({
  environment,
  environments,
  loadError,
  disabled,
  onSelect,
}: TerminalConnectionMenuProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const parsed = useMemo(
    () => (query.trim() ? resolveSshConnectionInput(query, environments) : null),
    [environments, query],
  );
  const normalizedQuery = query
    .trim()
    .replace(/^ssh\s+/i, "")
    .toLowerCase();
  const hasSavedMatch =
    normalizedQuery.length > 0 &&
    environments.some((item) =>
      [item.id, item.label, item.host, sshEnvironmentSummary(item)].some((value) =>
        value.toLowerCase().includes(normalizedQuery),
      ),
    );
  const activeIdentity = terminalEnvironmentIdentity(environment);
  const activeLabel = environment.kind === "local" ? "Local shell" : environment.ssh.label;
  const showDirectAction =
    parsed?.ok &&
    (/^\s*ssh\s+/i.test(query) || (parsed.environment.source === "direct" && !hasSavedMatch));

  const select = (next: TerminalEnvironment) => {
    setOpen(false);
    setQuery("");
    if (terminalEnvironmentIdentity(next) !== activeIdentity) onSelect(next);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`Terminal connection: ${activeLabel}`}
          aria-expanded={open}
          className="flex h-6 min-w-0 max-w-[45%] items-center gap-1.5 rounded border border-charcoal-border bg-charcoal-card px-2 text-[11px] text-cream transition-colors hover:bg-charcoal-hover focus-visible:border-charcoal-active focus-visible:ring-1 focus-visible:ring-charcoal-active disabled:cursor-not-allowed disabled:bg-charcoal-canvas disabled:text-cream-muted"
          title="Choose a local or SSH connection"
        >
          {environment.kind === "local" ? (
            <Laptop className="size-3 shrink-0" aria-hidden="true" />
          ) : (
            <Server className="size-3 shrink-0" aria-hidden="true" />
          )}
          <span className="truncate">{activeLabel}</span>
          <ChevronDown
            className={`size-3 shrink-0 text-cream-muted transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={5}
        collisionPadding={8}
        aria-label="Terminal connections"
        className="w-[min(360px,calc(100vw-16px))] overflow-hidden p-0"
      >
        <Command loop>
          <CommandInput
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="user@host[:port] or SSH alias"
            aria-label="SSH connection"
            className="h-8 text-[11px]"
          />
          <CommandList className="max-h-[280px]">
            {showDirectAction && parsed.ok ? (
              <CommandGroup heading="Connect" forceMount>
                <CommandItem
                  forceMount
                  value={`connect ${query}`}
                  onSelect={() => select({ kind: "ssh", ssh: parsed.environment })}
                  className="min-h-10"
                >
                  <Server className="size-3.5" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-cream">
                      {parsed.environment.source === "configured"
                        ? parsed.environment.label
                        : sshEnvironmentSummary(parsed.environment)}
                    </span>
                    <span className="block truncate text-[10px] text-cream-muted">
                      Connect with OpenSSH
                    </span>
                  </span>
                  <CornerDownLeft className="size-3 text-cream-muted" aria-hidden="true" />
                </CommandItem>
              </CommandGroup>
            ) : null}
            {showDirectAction ? <CommandSeparator /> : null}
            <CommandGroup heading="Connections">
              <CommandItem value="local shell" onSelect={() => select(localTerminalEnvironment)}>
                <Laptop className="size-3.5" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-[12px]">Local shell</span>
                {environment.kind === "local" ? (
                  <Check className="size-3.5 text-cream" aria-hidden="true" />
                ) : null}
              </CommandItem>
              {environments.map((item) => {
                const identity = terminalEnvironmentIdentity({ kind: "ssh", ssh: item });
                return (
                  <CommandItem
                    key={identity}
                    value={`${item.label} ${sshEnvironmentSummary(item)}`}
                    keywords={[item.id, item.host, item.user ?? ""]}
                    onSelect={() => select({ kind: "ssh", ssh: item })}
                    className="min-h-10"
                  >
                    <Server className="size-3.5" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] text-cream">{item.label}</span>
                      <span className="block truncate text-[10px] text-cream-muted">
                        {sshEnvironmentSummary(item)}
                      </span>
                    </span>
                    {identity === activeIdentity ? (
                      <Check className="size-3.5 text-cream" aria-hidden="true" />
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {!showDirectAction ? (
              <CommandEmpty className="px-4 py-5 text-[11px] text-cream-muted">
                No saved connection matches.
              </CommandEmpty>
            ) : null}
          </CommandList>
          {query.trim() && parsed && !parsed.ok ? (
            <p
              className="border-t border-charcoal-border px-3 py-2 text-[10px] leading-4 text-notification-red"
              role="alert"
            >
              {parsed.message}
            </p>
          ) : loadError ? (
            <p
              className="border-t border-charcoal-border px-3 py-2 text-[10px] text-cream-muted"
              role="status"
            >
              Saved SSH hosts are unavailable. Direct connections still work.
            </p>
          ) : (
            <p className="border-t border-charcoal-border px-3 py-2 text-[10px] text-cream-muted">
              You can also enter <span className="font-mono text-cream">ssh user@host -p 22</span>.
            </p>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
