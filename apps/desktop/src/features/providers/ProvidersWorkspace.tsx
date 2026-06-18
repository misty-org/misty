import { RemoteEditPanel } from "./components/RemoteEditPanel";
import { RemoteListPanel } from "./components/RemoteListPanel";
import { selectProviderDerived, useProvidersStore } from "./useProvidersStore";

export function ProvidersWorkspace() {
  const state = useProvidersStore();
  const { dirty, validRemoteName, configKeys } = selectProviderDerived(state);

  return (
    <section className="workspace">
      <RemoteListPanel
        remotes={state.providers?.remotes ?? []}
        selectedRemoteName={state.draft?.originalName ?? null}
        loading={state.loading}
        working={state.working}
        onRefresh={() => void state.load(true)}
        onSelectRemote={(name) => void state.selectRemote(name)}
      />

      <RemoteEditPanel
        draft={state.draft}
        configPaths={state.configPaths}
        configKeys={configKeys}
        dirty={dirty}
        working={state.working}
        tokenVisible={state.tokenVisible}
        validRemoteName={validRemoteName}
        onDraftName={state.setDraftName}
        onConfigField={state.setConfigField}
        onTokenField={state.setTokenField}
        onTokenVisible={state.setTokenVisible}
        onTest={() => void state.testConnection()}
        onReveal={() => void state.revealConfig()}
        onSave={() => void state.saveRemote()}
      />
    </section>
  );
}
