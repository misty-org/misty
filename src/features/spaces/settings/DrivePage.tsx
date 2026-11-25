import { HardDrive, Plus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  Button,
  ErrorState,
  IconButton,
  Input,
  ListRow,
  ListRowSkeleton,
  RowGroupSection,
  RowTools,
  Text,
  notify,
} from "@misty/ui";
import { driveNative } from "../drive";
import { SpaceSettingsFrame, type SpaceSettingsNav } from "./SpaceSettingsFrame";
import {
  ignoreRules,
  readSpaceIgnore,
  withoutRule,
  withRule,
  writeSpaceIgnore,
  type SpaceIgnore,
} from "./space_ignore";

export function DrivePage({ nav }: { nav: SpaceSettingsNav }) {
  const { space } = nav;
  const [ignore, setIgnore] = useState<SpaceIgnore | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    readSpaceIgnore(space.id).then(setIgnore, () => setFailed(true));
  }, [space.id]);
  useEffect(load, [load]);

  const save = async (text: string) => {
    if (!ignore || saving) return;
    setSaving(true);
    try {
      setIgnore(await writeSpaceIgnore(space.id, ignore, text));
    } catch {
      notify({ message: "The list wasn't saved. Try again.", tone: "error" });
      load();
    } finally {
      setSaving(false);
    }
  };

  const add = () => {
    const rule = draft.trim();
    setAdding(false);
    setDraft("");
    if (rule && ignore) void save(withRule(ignore.text, rule));
  };

  const rules = ignore ? ignoreRules(ignore.text) : [];

  return (
    <SpaceSettingsFrame
      nav={nav}
      title="Drive"
      actions={
        <Button
          icon={HardDrive}
          onClick={() =>
            void driveNative
              .reveal(space.id)
              .catch(() =>
                notify({ message: "The drive couldn't be shown. Try again.", tone: "error" }),
              )
          }
        >
          Show in Finder
        </Button>
      }
    >
      {failed ? (
        <ErrorState
          inline
          title="The drive's list couldn't load"
          action={{ label: "Try again", onClick: load }}
        />
      ) : (
        <RowGroupSection
          title="Kept off the drive"
          count={ignore ? rules.length : undefined}
          description="Files and folders that match stay on each person's computer."
          action={
            ignore
              ? {
                  label: "Add",
                  icon: Plus,
                  showLabel: true,
                  disabled: saving || adding,
                  onSelect: () => setAdding(true),
                }
              : undefined
          }
        >
          {!ignore ? (
            <ListRowSkeleton label="Loading the drive's list" rows={3} />
          ) : (
            <>
              {rules.map((rule) => (
                <ListRow
                  key={rule}
                  label={rule}
                  trailing={
                    <RowTools reveal="hover">
                      <IconButton
                        size="sm"
                        label={`Remove ${rule}`}
                        disabled={saving}
                        onClick={() => void save(withoutRule(ignore.text, rule))}
                      >
                        <X />
                      </IconButton>
                    </RowTools>
                  }
                />
              ))}
              {adding ? (
                <Input
                  autoFocus
                  aria-label="Name or pattern to keep off the drive"
                  placeholder="renders/ or *.mov"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={add}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      setDraft("");
                      setAdding(false);
                    }
                  }}
                />
              ) : null}
              {!rules.length && !adding ? (
                <Text as="p" size="meta" tone="muted" className="px-3 py-2.5">
                  Everything in the Space syncs
                </Text>
              ) : null}
            </>
          )}
        </RowGroupSection>
      )}
    </SpaceSettingsFrame>
  );
}
