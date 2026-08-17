import { Fragment } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useCodingWorkspaceStore } from "../store/useCodingWorkspaceStore";
import { EditorGroupPane } from "./EditorGroup";

interface EditorAreaProps {
  rootPath: string;
}

export function EditorArea({ rootPath }: EditorAreaProps) {
  const groups = useCodingWorkspaceStore((state) => state.groups);
  const activeGroupId = useCodingWorkspaceStore((state) => state.activeGroupId);
  const canSplit = groups.length < 2;

  if (groups.length === 1) {
    const [group] = groups;
    if (!group) return null;
    return (
      <EditorGroupPane
        group={group}
        isFocused
        canSplit={canSplit}
        rootPath={rootPath}
      />
    );
  }

  return (
    <PanelGroup direction="horizontal" className="min-h-0">
      {groups.map((group, index) => (
        <Fragment key={group.id}>
          {index > 0 ? (
            <PanelResizeHandle className="w-px bg-charcoal-border transition-colors hover:bg-charcoal-active" />
          ) : null}
          <Panel minSize={20} defaultSize={100 / groups.length}>
            <EditorGroupPane
              group={group}
              isFocused={group.id === activeGroupId}
              canSplit={false}
              rootPath={rootPath}
            />
          </Panel>
        </Fragment>
      ))}
    </PanelGroup>
  );
}
