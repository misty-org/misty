// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
/**
 * The repositories the skills hub reads skills from: each engine's Skills catalog on the
 * Plugins page lists what they hold, then skills.sh as the person types.
 */
import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  SkeletonList,
  Text,
} from "@/shared/ui";
import { t } from "./strings";
import type { SkillRepo } from "./types";
import { useSkillDiscovery } from "./useSkillDiscovery";

/** The dialog, reading the hub's repositories only while it is open. */
export function SkillReposDialog({ onClose }: { onClose: () => void }) {
  const discovery = useSkillDiscovery(true);
  return (
    <RepoDialog
      repos={discovery.repos}
      loading={discovery.reposLoading}
      onClose={onClose}
      onAdd={(repo) => discovery.addRepo(repo)}
      onRemove={(owner, name) => discovery.removeRepo(owner, name)}
    />
  );
}

function RepoDialog({
  repos,
  loading,
  onClose,
  onAdd,
  onRemove,
}: {
  repos: SkillRepo[];
  loading: boolean;
  onClose: () => void;
  onAdd: (repo: { owner: string; name: string; branch: string }) => Promise<void>;
  onRemove: (owner: string, name: string) => Promise<void>;
}) {
  const [owner, setOwner] = useState("");
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("main");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await onAdd({ owner: owner.trim(), name: name.trim(), branch: branch.trim() || "main" });
      setOwner("");
      setName("");
      setBranch("main");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = (repo: SkillRepo) => {
    setError(null);
    void onRemove(repo.owner, repo.name).catch((err: unknown) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-120">
        <DialogHeader>
          <DialogTitle>{t("repos.title")}</DialogTitle>
        </DialogHeader>
        {loading ? (
          // The list's own rows: 36px, a hairline between them, Remove at the end.
          <SkeletonList
            label={t("repos.title")}
            rows={3}
            trailing="button-sm"
            className="gap-0 divide-y"
            rowClassName="min-h-9 py-1.5"
          />
        ) : (
          <ul className="flex max-h-48 flex-col overflow-y-auto">
            {repos.map((repo) => (
              <li
                key={`${repo.owner}/${repo.name}`}
                className="flex items-center justify-between gap-2 border-t py-1.5 first:border-t-0"
              >
                <Text full tone="default" className="text-sm">
                  {repo.owner}/{repo.name}
                  <Text bare tone="muted" className="ml-1">
                    @{repo.branch}
                  </Text>
                </Text>
                <Button size="sm" onClick={() => remove(repo)}>
                  {t("repos.remove")}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-[1fr_1fr_6rem] gap-2">
          {(
            [
              ["owner", owner, setOwner],
              ["name", name, setName],
              ["branch", branch, setBranch],
            ] as const
          ).map(([key, value, set]) => (
            <div key={key} className="grid gap-1.5">
              <Label htmlFor={`skill-repo-${key}`}>{t(`repos.${key}`)}</Label>
              <Input
                id={`skill-repo-${key}`}
                value={value}
                onChange={(event) => set(event.target.value)}
              />
            </div>
          ))}
        </div>
        {error ? (
          <Text bare as="p" role="alert" tone="bright" className="text-xs">
            {error}
          </Text>
        ) : null}
        <DialogFooter className="gap-2">
          <Button size="lg" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button
            size="lg"
            variant="primary"
            disabled={!owner.trim() || !name.trim() || busy}
            onClick={() => void add()}
          >
            {t("repos.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
