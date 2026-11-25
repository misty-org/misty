import { useState } from "react";
import {
  Button,
  FaceEdit,
  Input,
  RowGroupStack,
  SettingsRow,
  SettingsSection,
  notify,
} from "@misty/ui";
import { spacesApi } from "../api/api";
import type { Space } from "../api/dto/entities";
import { SpaceAvatar } from "../components/SpaceAvatar";
import { DeleteSpaceDialog } from "../components/SpaceLifecycleDialogs";
import { useSpaceLifecycleActions } from "../components/use_space_lifecycle_actions";
import { useSpacePictureEditor } from "../components/UseSpacePictureEditor";
import { useSpacesStore } from "../list/use_spaces_store";
import { SpaceBoosts } from "./SpaceBoosts";
import { SpaceSettingsFrame, type SpaceSettingsNav } from "./SpaceSettingsFrame";
import { canDeleteSpace, canEditSpace } from "./space_settings_pages";

export function OverviewPage({ nav }: { nav: SpaceSettingsNav }) {
  const { space } = nav;
  const controller = useSpaceLifecycleActions(space.id);
  return (
    <SpaceSettingsFrame nav={nav} title="Overview">
      <RowGroupStack>
        {canEditSpace(space) ? (
          <SettingsSection title="Profile">
            <PictureRow space={space} />
            <NameRow space={space} />
          </SettingsSection>
        ) : null}
        {space.is_default ? null : <SpaceBoosts spaceId={space.id} />}
        {canDeleteSpace(space) ? (
          <SettingsSection title="Delete">
            <SettingsRow
              label="Delete Space"
              description="Its channels, chats, files and agents go for everyone."
            >
              <Button
                variant="danger"
                onClick={() => {
                  controller.clearError();
                  controller.setDeleteConfirmation("");
                  controller.setDeleteOpen(true);
                }}
              >
                Delete Space
              </Button>
            </SettingsRow>
          </SettingsSection>
        ) : null}
      </RowGroupStack>
      <DeleteSpaceDialog spaceName={space.name} controller={controller} />
    </SpaceSettingsFrame>
  );
}

function PictureRow({ space }: { space: Space }) {
  const editor = useSpacePictureEditor(space);
  const [removing, setRemoving] = useState(false);
  const remove = async () => {
    setRemoving(true);
    try {
      await spacesApi.removeSpacePicture(space.id);
      await useSpacesStore.getState().load({ force: true });
    } catch (cause) {
      notify({
        message: cause instanceof Error ? cause.message : "The picture wasn't removed. Try again.",
        tone: "error",
      });
    } finally {
      setRemoving(false);
    }
  };
  return (
    <SettingsRow label="Picture">
      <span className="relative inline-flex">
        <SpaceAvatar space={space} className="size-12" />
        {removing ? null : (
          <FaceEdit onEdit={editor.open} label="Edit Space picture" shape="tile" />
        )}
      </span>
      {editor.dialog}
      <Button disabled={removing} onClick={editor.open}>
        Edit
      </Button>
      {space.avatar_version ? (
        <Button variant="quiet" disabled={removing} onClick={() => void remove()}>
          Remove
        </Button>
      ) : null}
    </SettingsRow>
  );
}

function NameRow({ space }: { space: Space }) {
  const renameSpace = useSpacesStore((state) => state.renameSpace);
  const [name, setName] = useState(space.name);
  const save = () => {
    const next = name.trim().slice(0, 64);
    if (!next || next === space.name) {
      setName(space.name);
      return;
    }
    void renameSpace(space.id, next).catch(() => {
      setName(space.name);
      notify({ message: "The name wasn't saved. Try again.", tone: "error" });
    });
  };
  return (
    <SettingsRow label="Name">
      <Input
        aria-label="Space name"
        className="w-72"
        maxLength={64}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setName(space.name);
        }}
      />
    </SettingsRow>
  );
}
