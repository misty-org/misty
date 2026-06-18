import { Briefcase, Download, FileText, Folder, HardDrive, Home, Monitor } from "lucide-react";

interface ExplorerSidebarProps {
  homePath: string;
  activePath: string;
  onNavigate: (path: string) => void;
}

export function ExplorerSidebar(props: ExplorerSidebarProps) {
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
        </div>
      </section>

      <section>
        <h2>Remote</h2>
        <div className="sidebar-muted">Loading remote...</div>
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
}
