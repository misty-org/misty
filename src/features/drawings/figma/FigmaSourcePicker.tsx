import { parseFigmaFileKey } from "@/api/integrations/figma";
import type { AccountConnection } from "@/api/connections";
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/shared/ui";
import { FolderSearch, Link2, LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { useFigmaDrawingsStore } from "./useFigmaDrawingsStore";

export function FigmaSourcePicker(props: { spaceId: string; accounts: AccountConnection[] }) {
  const store = useFigmaDrawingsStore();
  const [connectionId, setConnectionId] = useState(props.accounts[0]?.id ?? "");
  const [fileInput, setFileInput] = useState("");
  const [teamId, setTeamId] = useState("");
  const [projectId, setProjectId] = useState("");
  const fileKey = useMemo(() => parseFigmaFileKey(fileInput), [fileInput]);
  const account = props.accounts.find((item) => item.id === connectionId) ?? props.accounts[0];
  const canBrowseProjects = account?.capabilities?.includes("drawings_projects") === true;

  const linkFile = async () => {
    if (!account || !fileKey) return;
    try {
      await store.bindFile(props.spaceId, account.id, fileKey);
      setFileInput("");
    } catch {}
  };

  return (
    <section className="mt-5 rounded-xl border border-charcoal-border bg-charcoal-card p-4">
      <div className="flex items-start gap-3">
        <Link2 className="mt-0.5 size-4 shrink-0 text-cream-muted" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-cream-bright">Link a Figma file</h3>
          <p className="mt-1 text-xs text-cream-muted">
            Paste a Figma file, design, or FigJam board URL. Misty reads only that source.
          </p>
        </div>
      </div>

      {props.accounts.length > 1 ? (
        <div className="mt-4 grid gap-1.5">
          <Label htmlFor="figma-account">Account</Label>
          <Select value={account?.id ?? ""} onValueChange={setConnectionId}>
            <SelectTrigger id="figma-account" className="h-9">
              {account?.account_display ?? "Choose an account"}
            </SelectTrigger>
            <SelectContent>
              {props.accounts.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.account_display}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className="mt-4 flex gap-2">
        <Input
          aria-label="Figma file URL or key"
          placeholder="https://www.figma.com/design/…"
          value={fileInput}
          onChange={(event) => setFileInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && fileKey) void linkFile();
          }}
        />
        <Button disabled={!fileKey || store.busy === "bind"} onClick={() => void linkFile()}>
          {store.busy === "bind" ? <LoaderCircle className="size-4 animate-spin" /> : null}
          Link file
        </Button>
      </div>
      {fileInput.trim() && !fileKey ? (
        <p className="mt-2 text-xs text-[#d68b80]" role="alert">
          Enter a valid Figma file key or an HTTPS figma.com file, design, or board URL.
        </p>
      ) : null}

      <div className="mt-4 border-t border-charcoal-border pt-4">
        <div className="flex items-start gap-3">
          <FolderSearch className="mt-0.5 size-4 shrink-0 text-cream-muted" aria-hidden />
          <div>
            <p className="m-0 text-xs font-medium text-cream">Project browsing</p>
            <p className="mt-1 text-xs text-cream-muted">
              {canBrowseProjects
                ? "Available for this account's legacy Figma permission."
                : "Unavailable to public Figma OAuth apps. Paste a direct file link above."}
            </p>
          </div>
        </div>
        {canBrowseProjects ? (
          <ProjectBrowser
            accountId={account.id}
            spaceId={props.spaceId}
            teamId={teamId}
            projectId={projectId}
            setTeamId={setTeamId}
            setProjectId={setProjectId}
          />
        ) : null}
      </div>
    </section>
  );
}

function ProjectBrowser(props: {
  accountId: string;
  spaceId: string;
  teamId: string;
  projectId: string;
  setTeamId: (value: string) => void;
  setProjectId: (value: string) => void;
}) {
  const store = useFigmaDrawingsStore();
  return (
    <div className="mt-3 grid gap-3">
      <div className="flex gap-2">
        <Input
          aria-label="Figma team ID"
          placeholder="Team ID"
          value={props.teamId}
          onChange={(event) => props.setTeamId(event.target.value)}
        />
        <Button
          variant="outline"
          disabled={!props.teamId.trim() || store.busy === "projects"}
          onClick={() => void store.discoverProjects(props.accountId, props.teamId.trim())}
        >
          Find projects
        </Button>
      </div>
      {store.projects.length ? (
        <Select
          value={props.projectId}
          onValueChange={(value) => {
            props.setProjectId(value);
            void store.discoverFiles(props.accountId, value);
          }}
        >
          <SelectTrigger aria-label="Figma project" className="h-9">
            {store.projects.find((item) => item.id === props.projectId)?.name ?? "Choose project"}
          </SelectTrigger>
          <SelectContent>
            {store.projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {store.files.map((file) => (
        <div
          key={file.key}
          className="flex items-center gap-2 rounded-md border border-charcoal-border p-2"
        >
          <span className="min-w-0 flex-1 truncate text-xs text-cream">{file.name}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void store.bindFile(props.spaceId, props.accountId, file.key)}
          >
            Link
          </Button>
        </div>
      ))}
    </div>
  );
}
