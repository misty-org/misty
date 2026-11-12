import {
  EmptyState,
  FindBar,
  MenuItem,
  PageStage,
  SearchablePicker,
  TabStrip,
  Text,
  TreeRow,
  type TabStripTab,
} from "@/shared/ui";
import { Cloud, FileCode, Folder, GitBranch, Pencil, Plus, X } from "lucide-react";
import { useRef, useState } from "react";
import { GalleryRow, GallerySection } from "./GalleryLayout";

const sampleTabs: TabStripTab[] = [
  { id: "files", label: "Files", icon: <Folder aria-hidden className="size-4" /> },
  {
    id: "app",
    label: "App.tsx",
    full: "src/app/App.tsx",
    icon: <FileCode aria-hidden className="size-4" />,
    closeLabel: "Close App.tsx",
  },
  {
    id: "long",
    label: "a-file-with-a-very-long-name-that-fades.ts",
    icon: <FileCode aria-hidden className="size-4" />,
    closeLabel: "Close a-file-with-a-very-long-name-that-fades.ts",
  },
];

const branches = [
  { id: "local:main", value: "main", label: "main", icon: GitBranch },
  {
    id: "local:redesign",
    value: "redesign/design-protocol",
    label: "redesign/design-protocol",
    icon: GitBranch,
  },
  { id: "remote:release", value: "origin/release", label: "origin/release", icon: Cloud },
];

function SampleTabs() {
  const [tabs, setTabs] = useState(sampleTabs);
  const [active, setActive] = useState("app");
  return (
    <div className="w-96">
      <TabStrip
        label="Sample tabs"
        tabs={tabs.map((tab) => ({
          ...tab,
          menu: tab.closeLabel ? (
            <MenuItem
              icon={X}
              label="Close"
              onSelect={() => setTabs(tabs.filter((t) => t !== tab))}
            />
          ) : undefined,
        }))}
        active={active}
        onSelect={setActive}
        onClose={(id) => setTabs(tabs.filter((tab) => tab.id !== id))}
        onReorder={(id, index) => {
          const moved = tabs.find((tab) => tab.id === id)!;
          const rest = tabs.filter((tab) => tab.id !== id);
          setTabs([...rest.slice(0, index), moved, ...rest.slice(index)]);
        }}
        end={null}
      />
    </div>
  );
}

function SampleFind() {
  const [query, setQuery] = useState("misty");
  const [matchCase, setMatchCase] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replacement, setReplacement] = useState("");
  return (
    <div className="w-full max-w-xl">
      <FindBar
        label="Sample find"
        find={{ value: query, onChange: setQuery }}
        caseSensitive={matchCase}
        onCaseSensitive={() => setMatchCase(!matchCase)}
        wholeWord={false}
        onWholeWord={() => {}}
        regex={false}
        onRegex={() => {}}
        count={query ? "2/7" : "0/0"}
        empty={false}
        canStep={Boolean(query)}
        onPrevious={() => {}}
        onNext={() => {}}
        onClose={() => setQuery("")}
        replace={{
          value: replacement,
          onChange: setReplacement,
          open: replaceOpen,
          onToggle: () => setReplaceOpen(!replaceOpen),
          canReplace: Boolean(query),
          onReplace: () => {},
          onReplaceAll: () => {},
        }}
      />
    </div>
  );
}

function SamplePicker() {
  const [branch, setBranch] = useState("main");
  return (
    <SearchablePicker
      label="Branch"
      icon={GitBranch}
      options={branches}
      value={branch}
      searchLabel="Search branches"
      emptyLabel="No branches match"
      onPick={setBranch}
      actions={[{ icon: Plus, label: "New branch", onSelect: () => {} }]}
    />
  );
}

function SampleTree() {
  const [open, setOpen] = useState(true);
  const rowMenu = <MenuItem icon={Pencil} label="Rename" onSelect={() => {}} />;
  return (
    <div className="grid w-80 gap-px" role="list" aria-label="Sample tree">
      <TreeRow
        label="src"
        chevron
        expanded={open}
        onOpen={() => setOpen(!open)}
        end={
          <Text size="meta" tone="muted">
            3
          </Text>
        }
        menu={rowMenu}
      />
      {open ? (
        <>
          <TreeRow
            label="App.tsx"
            depth={1}
            tone="modified"
            icon={<FileCode />}
            selected
            onOpen={() => {}}
            end={
              <Text size="meta" tone="muted">
                M
              </Text>
            }
            menu={rowMenu}
          />
          <TreeRow
            label="newFile.ts"
            depth={1}
            tone="added"
            icon={<FileCode />}
            onOpen={() => {}}
          />
          <TreeRow
            label="a-very-long-file-name-that-fades-at-the-edge.ts"
            detail="src/features/agents/context-panel/"
            depth={1}
            icon={<FileCode />}
            onOpen={() => {}}
          />
        </>
      ) : null}
    </div>
  );
}

function SampleStage() {
  const host = useRef<HTMLDivElement>(null);
  return (
    <div className="flex h-40 w-80">
      <PageStage hostRef={host} placed={false} presented={false} framed>
        <EmptyState title="No page yet" line="The agent's page shows here once it opens one." />
      </PageStage>
    </div>
  );
}

export function WorkspaceSection() {
  return (
    <GallerySection title="Workspace panes">
      <GalleryRow label="TabStrip">
        <SampleTabs />
      </GalleryRow>
      <GalleryRow label="FindBar">
        <SampleFind />
      </GalleryRow>
      <GalleryRow label="SearchablePicker">
        <SamplePicker />
      </GalleryRow>
      <GalleryRow label="TreeRow">
        <SampleTree />
      </GalleryRow>
      <GalleryRow label="PageStage">
        <SampleStage />
      </GalleryRow>
    </GallerySection>
  );
}
