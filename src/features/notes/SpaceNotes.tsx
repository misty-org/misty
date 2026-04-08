import type { SpaceNotesProps } from "@/models/interfaces/features/notes/SpaceNotes";
export type { SpaceNotesProps } from "@/models/interfaces/features/notes/SpaceNotes";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "@/features/auth/AuthContext";
import { useNotesStore } from "@/stores/notes";
import { adjacentIntegrations } from "@/features/notes/connectors/registry";
import { defaultNoteGroup, isNoteGroupId, selectVisibleNotes } from "@/features/notes/noteFilters";
import { NotesTopBar } from "./components/NotesTopBar";
import { NoteListPanel } from "./components/NoteListPanel";
import { NoteReadingPane } from "./components/NoteReadingPane";
import { NoteContextPanel } from "./components/NoteContextPanel";
import { NotesIntegrationsDialog } from "./components/NotesIntegrationsDialog";
import { NewNoteDialog } from "./components/NewNoteDialog";
import { NotionSourcesDialog } from "./components/NotionSourcesDialog";

const shellClass =
  "grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] bg-background text-foreground";

const bodyClass = "grid min-h-0 grid-cols-[minmax(280px,340px)_minmax(0,1fr)] overflow-hidden";

const bodyWithContextClass =
  "grid min-h-0 overflow-hidden grid-cols-[minmax(280px,340px)_minmax(0,1fr)_248px] max-[1100px]:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]";

export function SpaceNotes(props: SpaceNotesProps) {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const groupParam = searchParams.get("group") ?? "";
  const activeGroup = isNoteGroupId(groupParam) ? groupParam : defaultNoteGroup;

  const store = useNotesStore(
    useShallow((state) => ({
      phase: state.phase,
      notes: state.notes,
      connectorErrors: state.connectorErrors,
      selectedNoteId: state.selectedNoteId,
      query: state.query,
      syncing: state.syncing,
      lastSyncedAt: state.lastSyncedAt,
      contextPanelOpen: state.contextPanelOpen,
      publishingNoteId: state.publishingNoteId,
      integrationsOpen: state.integrationsOpen,
      connectorRevision: state.connectorRevision,
      registry: state.registry,
    })),
  );
  const actions = useNotesStore(
    useShallow((state) => ({
      load: state.load,
      refresh: state.refresh,
      syncAll: state.syncAll,
      setQuery: state.setQuery,
      selectNote: state.selectNote,
      toggleContextPanel: state.toggleContextPanel,
      setIntegrationsOpen: state.setIntegrationsOpen,
      toggleFavorite: state.toggleFavorite,
      createNote: state.createNote,
      updateNoteBody: state.updateNoteBody,
      assignSpace: state.assignSpace,
      openInSource: state.openInSource,
      publishNote: state.publishNote,
      connectConnector: state.connectConnector,
      disconnectConnector: state.disconnectConnector,
    })),
  );

  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const [notionSourcesOpen, setNotionSourcesOpen] = useState(false);

  useEffect(() => {
    if (user?.id) void actions.load(user.id, props.spaceId, props.spaceName);
  }, [actions.load, props.spaceId, props.spaceName, user?.id]);

  const loading = store.phase === "loading" || store.phase === "idle";

  const visibleNotes = useMemo(
    () => selectVisibleNotes(store.notes, activeGroup, store.query, Date.now(), props.spaceId),
    [store.notes, activeGroup, store.query, props.spaceId],
  );

  // connectorRevision is read so status pills re-render when a connector's
  // lifecycle changes; the connector objects themselves are stable references.
  const connectors = useMemo(
    () => store.registry.list(),
    [store.registry, store.connectorRevision],
  );

  const notionConnector = useMemo(
    () => store.registry.forSource("notion"),
    [store.registry, store.connectorRevision],
  );

  const selectedNote = store.notes.find((note) => note.id === store.selectedNoteId);
  const selectedConnector = selectedNote
    ? store.registry.forSource(selectedNote.source)
    : undefined;

  const spaces = useMemo(
    () => [{ id: props.spaceId, name: props.spaceName }],
    [props.spaceId, props.spaceName],
  );

  function selectGroup(group: string) {
    const next = new URLSearchParams(searchParams);
    next.set("group", group);
    setSearchParams(next, { replace: true });
  }

  return (
    <div className={shellClass}>
      <NotesTopBar
        query={store.query}
        activeGroup={activeGroup}
        syncing={store.syncing}
        lastSyncedAt={store.lastSyncedAt}
        contextPanelOpen={store.contextPanelOpen}
        onQueryChange={actions.setQuery}
        onSelectGroup={selectGroup}
        onSync={() => void actions.syncAll()}
        onNewNote={() => setNewNoteOpen(true)}
        onToggleContextPanel={actions.toggleContextPanel}
      />

      <p
        className="m-0 border-b border-border/60 bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground"
        role="note"
      >
        Misty notes are saved privately on this desktop. Connected Notion pages remain in Notion.
      </p>

      <div className={store.contextPanelOpen ? bodyWithContextClass : bodyClass}>
        <NoteListPanel
          notes={visibleNotes}
          activeGroup={activeGroup}
          query={store.query}
          loading={loading}
          spaceName={props.spaceName}
          selectedNoteId={store.selectedNoteId}
          connectorErrors={store.connectorErrors}
          notionConnector={notionConnector}
          onSelectNote={actions.selectNote}
          onNewNote={() => setNewNoteOpen(true)}
          onConnectNotion={() => {
            if (notionConnector) void actions.connectConnector(notionConnector.id);
          }}
          onClearQuery={() => actions.setQuery("")}
        />

        <NoteReadingPane
          note={selectedNote}
          loading={loading}
          onSaveBody={
            selectedConnector?.capabilities.update
              ? (noteId, body) => void actions.updateNoteBody(noteId, body)
              : undefined
          }
          onOpenInSource={(noteId) => void actions.openInSource(noteId)}
          publishing={store.publishingNoteId === selectedNote?.id}
          onPublishToNotion={
            notionConnector?.capabilities.create && notionConnector.status() === "connected"
              ? (noteId) => void actions.publishNote(noteId)
              : undefined
          }
          onToggleFavorite={
            selectedNote?.source === "misty"
              ? (noteId) => void actions.toggleFavorite(noteId)
              : undefined
          }
          onNewNote={() => setNewNoteOpen(true)}
        />

        {store.contextPanelOpen ? (
          <div className="min-h-0 max-[1100px]:hidden">
            <NoteContextPanel
              note={selectedNote}
              spaces={spaces}
              onAssignSpace={
                selectedNote?.source === "misty"
                  ? (noteId, spaceId, spaceName) =>
                      void actions.assignSpace(noteId, spaceId, spaceName)
                  : undefined
              }
            />
          </div>
        ) : null}
      </div>

      <NotesIntegrationsDialog
        open={store.integrationsOpen}
        connectors={connectors}
        adjacent={adjacentIntegrations}
        busy={store.syncing}
        connectorErrors={store.connectorErrors}
        onOpenChange={actions.setIntegrationsOpen}
        onConnect={(connectorId) => void actions.connectConnector(connectorId)}
        onDisconnect={(connectorId) => void actions.disconnectConnector(connectorId)}
        onConfigure={(connectorId) => {
          const connector = store.registry.get(connectorId);
          if (connector?.capabilities.selectSources) setNotionSourcesOpen(true);
          else void connector?.configure?.();
        }}
      />

      <NotionSourcesDialog
        open={notionSourcesOpen}
        connector={notionConnector}
        onOpenChange={setNotionSourcesOpen}
        onSaved={() => void actions.refresh()}
      />

      <NewNoteDialog
        open={newNoteOpen}
        spaces={spaces}
        onOpenChange={setNewNoteOpen}
        onCreate={(input) => void actions.createNote(input)}
      />
    </div>
  );
}
