import { useState } from "react";
import { ExternalLink, PlugZap, RefreshCw, Unplug } from "lucide-react";
import { Button, Input } from "@/ui";
import { openSystemExternalLink } from "@/platform/openExternalLink";
import {
  normalizeLocalDeveloperWorkspaceUrl,
  readDeveloperWorkspaceUrl,
  suggestedDeveloperWorkspaceUrl,
  writeDeveloperWorkspaceUrl,
} from "./developerWorkspaceUrl";

const theiaDocsUrl = "https://theia-ide.org/docs/user_ai/";

export function DeveloperWorkspace() {
  const [connectedUrl, setConnectedUrl] = useState(readDeveloperWorkspaceUrl);
  const [draftUrl, setDraftUrl] = useState(
    () => readDeveloperWorkspaceUrl() || suggestedDeveloperWorkspaceUrl(),
  );
  const [error, setError] = useState("");
  const [frameKey, setFrameKey] = useState(0);

  const connect = () => {
    try {
      const url = normalizeLocalDeveloperWorkspaceUrl(draftUrl);
      writeDeveloperWorkspaceUrl(url);
      setConnectedUrl(url);
      setDraftUrl(url);
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not use that IDE address.");
    }
  };

  if (!connectedUrl) {
    return (
      <section className="grid h-full place-items-center overflow-auto bg-charcoal-bg p-8 text-cream">
        <div className="w-full max-w-2xl rounded-2xl border border-charcoal-border bg-charcoal-card p-7 shadow-xl">
          <div className="mb-6 flex size-12 items-center justify-center rounded-xl bg-charcoal-active text-cream-bright">
            <PlugZap size={24} strokeWidth={1.8} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Code, inside Misty</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-cream-muted">
            Connect an AI-native IDE running locally and it will live here as a normal Misty tab.
            Eclipse Theia AI is the recommended host; OpenVSCode Server and code-server work too.
          </p>

          <form
            className="mt-6 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              connect();
            }}
          >
            <Input
              value={draftUrl}
              aria-label="Local IDE address"
              placeholder="http://127.0.0.1:3000"
              spellCheck={false}
              onChange={(event) => setDraftUrl(event.target.value)}
            />
            <Button type="submit">Connect</Button>
          </form>
          {error ? <p className="mt-2 text-sm text-cream-bright">{error}</p> : null}

          <div className="mt-6 flex items-center justify-between gap-4 border-t border-charcoal-border pt-5">
            <p className="text-xs leading-5 text-cream-muted">
              The IDE must be listening on localhost. Misty never frames a remote development
              environment.
            </p>
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              onClick={() => void openSystemExternalLink(theiaDocsUrl)}
            >
              Theia AI setup
              <ExternalLink size={14} />
            </Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="grid h-full min-h-0 grid-rows-[36px_minmax(0,1fr)] bg-charcoal-bg">
      <div className="flex min-w-0 items-center gap-2 border-b border-charcoal-border bg-charcoal-sidebar px-2">
        <span
          className="min-w-0 flex-1 truncate pl-1 text-xs text-cream-muted"
          title={connectedUrl}
        >
          {connectedUrl}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          title="Reload IDE"
          aria-label="Reload IDE"
          onClick={() => setFrameKey((key) => key + 1)}
        >
          <RefreshCw size={13} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          title="Open IDE in browser"
          aria-label="Open IDE in browser"
          onClick={() => void openSystemExternalLink(connectedUrl)}
        >
          <ExternalLink size={13} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          title="Disconnect IDE"
          aria-label="Disconnect IDE"
          onClick={() => {
            writeDeveloperWorkspaceUrl("");
            setConnectedUrl("");
          }}
        >
          <Unplug size={13} />
        </Button>
      </div>
      <iframe
        key={frameKey}
        className="h-full w-full border-0 bg-[#1e1e1e]"
        src={connectedUrl}
        title="Code workspace"
        allow="clipboard-read; clipboard-write; fullscreen"
      />
    </section>
  );
}
