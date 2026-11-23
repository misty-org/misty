// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
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
  ListRow,
  ListRowSkeleton,
  RowGroup,
  Text,
} from "@misty/ui";
import { t } from "./strings";
import type { SkillRepo } from "./types";
import { useSkillDiscovery } from "./use_skill_discovery";

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
          <RowGroup>
            <ListRowSkeleton label={t("repos.title")} rows={3} lines={2} trailing="button-sm" />
          </RowGroup>
        ) : repos.length > 0 ? (
          <RowGroup className="max-h-48 overflow-y-auto">
            {repos.map((repo) => (
              <ListRow
                key={`${repo.owner}/${repo.name}`}
                label={`${repo.owner}/${repo.name}`}
                description={`@${repo.branch}`}
                trailing={
                  <Button size="sm" onClick={() => remove(repo)}>
                    {t("repos.remove")}
                  </Button>
                }
              />
            ))}
          </RowGroup>
        ) : null}
        <div className="grid grid-cols-[1fr_1fr_--spacing(24)] gap-2">
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
          <Text size="meta" bare as="p" role="alert" tone="bright">
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
