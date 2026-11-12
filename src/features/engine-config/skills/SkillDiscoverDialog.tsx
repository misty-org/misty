// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
/**
 * Discover details: a skills.sh entry has only name / repo / installs, so what the skill does is
 * read from the repo's SKILL.md (`remote_skill_content`, on demand, never for the whole list).
 * Description, body and any failure share one box; a failure offers GitHub instead of pretending
 * the content is empty.
 */
import { Download, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, Spinner } from "@/shared/ui";
import { SkillsHubError, skillsHubApi } from "./api";
import { SkillMarkdown } from "./SkillDetailDialog";
import { t } from "./strings";
import type { DiscoveredSkill, SkillRemoteContent } from "./types";

/** Why SKILL.md couldn't be read, with Try again and the repository. not_found gets its own
 *  explanation instead of the raw error. */
function DiscoverFailure({
  error,
  repoUrl,
  onRetry,
}: {
  error: { code?: string; message: string } | null;
  repoUrl: string;
  onRetry: () => void;
}) {
  const notFound = error?.code === "not_found";
  return (
    <div className="flex flex-col items-start gap-2">
      <p role="alert" className="text-sm text-cream-bright">
        {notFound ? t("discover.contentMissing") : t("discover.contentFailed")}
      </p>
      {/* The backend's own text (the folder name, the limit) says more than ours; not_found is
          already explained above. */}
      {error && !notFound ? (
        <p className="break-all font-mono text-xs text-cream-muted">{error.message}</p>
      ) : null}
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t("discover.retry")}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void openExternalLink(repoUrl)}>
          <ExternalLink aria-hidden />
          {t("discover.openRepo")}
        </Button>
      </div>
    </div>
  );
}

export function SkillDiscoverDialog({
  skill,
  installed,
  busy,
  onInstall,
  onClose,
}: {
  skill: DiscoveredSkill;
  installed: boolean;
  busy: boolean;
  onInstall: () => void;
  onClose: () => void;
}) {
  const [content, setContent] = useState<SkillRemoteContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  // A response arriving after the dialog closed must not change its state.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await skillsHubApi.remoteContent(skill);
      if (!alive.current) return;
      setContent(payload);
    } catch (caught) {
      if (!alive.current) return;
      setContent(null);
      setError({
        code: caught instanceof SkillsHubError ? caught.code : undefined,
        message: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [skill]);

  useEffect(() => {
    void load();
  }, [load]);

  const repoUrl = `https://github.com/${skill.repoOwner}/${skill.repoName}`;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="flex max-h-[80vh] max-w-[560px] flex-col gap-3">
        <DialogHeader className="min-w-0 pr-8">
          <DialogTitle className="truncate" title={skill.name}>
            {t("discover.detailTitle", { name: skill.name })}
          </DialogTitle>
          <div className="flex flex-wrap items-center gap-2 text-xs text-cream-muted">
            <Button
              variant="link"
              size="none"
              className="h-auto gap-1 text-xs"
              onClick={() => void openExternalLink(repoUrl)}
            >
              {skill.repoOwner}/{skill.repoName}
              <ExternalLink className="size-3.5" aria-hidden />
            </Button>
            {typeof skill.installs === "number" ? (
              <span>· {t("discover.installs", { count: skill.installs })}</span>
            ) : null}
            {content?.path ? (
              <span className="max-w-full truncate" title={content.path}>
                · {content.path}
              </span>
            ) : null}
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
          {content?.description ? (
            <p className="text-sm text-cream-muted">{content.description}</p>
          ) : null}
          <SkillMarkdown
            loading={loading}
            error={error?.message ?? null}
            content={content}
            loadingLabel={t("discover.contentLoading")}
            failed={<DiscoverFailure error={error} repoUrl={repoUrl} onRetry={() => void load()} />}
          />
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2">
          <p className="text-xs text-cream-muted">{t("discover.installTargets")}</p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              {t("common.close")}
            </Button>
            <Button variant="primary" size="sm" disabled={busy || installed} onClick={onInstall}>
              {busy ? (
                <Spinner size="sm" label={false} />
              ) : installed ? null : (
                <Download aria-hidden />
              )}
              {installed ? t("discover.installed") : t("discover.install")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
