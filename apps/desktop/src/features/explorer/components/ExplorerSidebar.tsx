import { Briefcase, Cloud, Download, FileText, Folder, HardDrive, Home, Monitor } from "lucide-react";
import { memo } from "react";
import type { ProviderRemote } from "../../../api/types";

interface ExplorerSidebarProps {
  homePath: string;
  activePath: string;
  mountRoot: string;
  remotes: ProviderRemote[];
  remoteLoading: boolean;
  pinnedPaths: string[];
  onNavigate: (path: string) => void;
}

export const ExplorerSidebar = memo(function ExplorerSidebar(props: ExplorerSidebarProps) {
  const quickAccess = [
    { label: "Home", icon: Home, path: props.homePath },
    { label: "Desktop", icon: Monitor, path: `${props.homePath}/Desktop` },
    { label: "Documents", icon: FileText, path: `${props.homePath}/Documents` },
    { label: "Downloads", icon: Download, path: `${props.homePath}/Downloads` },
    { label: "Projects", icon: Folder, path: `${props.homePath}/Projects` },
  ];

  return (
    <aside className="explorer-sidebar">
      <section>
        <h2>Workspace</h2>
        <button className="workspace-select">
          <Briefcase size={18} />
          Workspace 1
          <span>⌄</span>
        </button>
      </section>

      <section>
        <h2>Quick access</h2>
        <div className="sidebar-list">
          {quickAccess.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                className={props.activePath === item.path ? "selected" : ""}
                onClick={() => props.onNavigate(item.path)}
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
          {props.pinnedPaths.map((path) => (
            <button
              key={`pin:${path}`}
              className={props.activePath === path ? "selected" : ""}
              onClick={() => props.onNavigate(path)}
              title={path}
            >
              <Folder size={18} />
              <span>{path.split("/").filter(Boolean).pop() || path}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>Remote</h2>
        {props.remoteLoading && props.remotes.length === 0 ? (
          <div className="sidebar-muted">Loading remote...</div>
        ) : props.remotes.length === 0 ? (
          <div className="sidebar-muted">No remotes connected</div>
        ) : (
          <div className="sidebar-list remote-sidebar-list">
            {props.remotes.map((remote) => {
              const path = joinPath(props.mountRoot, remote.type, remote.name);
              return (
                <button
                  key={`${remote.type}:${remote.name}`}
                  className={props.activePath === path || props.activePath.startsWith(`${path}/`) ? "selected" : ""}
                  onClick={() => props.onNavigate(path)}
                  title={`${remote.type}: ${remote.name}`}
                >
                  <Cloud size={18} />
                  <span>{remote.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2>Devices</h2>
        <div className="device-card">
          <HardDrive size={18} />
          <div>
            <strong>Macintosh HD</strong>
            <span>434 GB / 460 GB used</span>
            <div className="device-meter"><i style={{ width: "82%" }} /></div>
          </div>
        </div>
      </section>
    </aside>
  );
});

function joinPath(...parts: string[]): string {
  const [first, ...rest] = parts;
  return [first.replace(/\/+$/, ""), ...rest.map((part) => part.replace(/^\/+|\/+$/g, ""))].join("/");
}
