import { Download, ExternalLink, FolderInput, RefreshCw, Trash2 } from "lucide-react";
import { useCachedResource } from "@/api/cache/cached_resource";
import {
  daysSince,
  EngineGlyph,
  relevantTargets,
  SkillMarkdown,
  skillsHubApi,
  skillsText as t,
  sourceKindOf,
  type SkillRow,
  type SkillTargetId,
  type SkillTargetInfo,
  type SkillUsageEntry,
} from "@/features/engine-config/skills";
import { openExternalLink } from "@/shared/platform/open_external_link";
import {
  Button,
  CatalogDone,
  Checkbox,
  ErrorState,
  MenuItem,
  InlineLink,
  ListRow,
  PropertyList,
  Skeleton,
  StoreDetail,
  StoreDetailSection,
  Text,
  type StoreFact,
} from "@misty/ui";
import { MakerTile, pluginMaker } from "./PluginMaker";
import type { SkillEntry } from "./skill_catalog";

interface SkillFile {
  path: string;
  markdown: string;
  truncated: boolean;
}

const compact = new Intl.NumberFormat(undefined, { notation: "compact" });

function lastUsedLabel(usage?: SkillUsageEntry | null): string {
  const days = daysSince(usage?.lastUsedAt);
  if (days == null) return t("detail.neverUsed");
  if (days <= 0) return t("usage.today");
  if (days < 30) return t("usage.daysAgo", { days });
  return t("usage.monthsAgo", { months: Math.max(1, Math.floor(days / 30)) });
}

export const repoLink = (entry: SkillEntry) =>
  entry.repo ? `https://github.com/${entry.repo}` : null;

export const skillMaker = (entry: SkillEntry) => pluginMaker({ link: repoLink(entry) });

export function SkillStoreDetail({
  entry,
  target,
  engineName,
  targets,
  pending,
  busyTarget,
  usage,
  usageLoading,
  usageError,
  hasUpdate,
  onClose,
  onInstall,
  onToggleTarget,
  onUpdate,
  onUninstall,
  onDeleteLocal,
  onImport,
}: {
  entry: SkillEntry | null;
  target: SkillTargetId;
  engineName: string;
  targets: SkillTargetInfo[];
  pending: boolean;
  busyTarget: string | null;
  usage: SkillUsageEntry | null;
  usageLoading: boolean;
  usageError: string | null;
  hasUpdate: boolean;
  onClose(): void;
  onInstall(entry: SkillEntry): void;
  onToggleTarget(skill: SkillRow, targetId: SkillTargetId, enabled: boolean): void;
  onUpdate(skill: SkillRow): void;
  onUninstall(skill: SkillRow): void;
  onDeleteLocal(skill: SkillRow): void;
  onImport(skill: SkillRow): void;
}) {
  const row = entry?.row ?? null;
  const found = entry?.found ?? null;
  const content = useCachedResource(
    row
      ? `engine-skills/content:${row.directory}`
      : found
        ? `engine-skills/remote:${found.key}`
        : null,
    async (): Promise<SkillFile> => {
      if (row) return skillsHubApi.content(row.directory);
      if (found) return skillsHubApi.remoteContent(found);
      throw new Error("Nothing to read");
    },
  );
  if (!entry) return null;
  const link = entry.link ?? repoLink(entry);
  const readonly = row?.readonly === true;
  const state = row?.targetStates?.[target] ?? "off";
  const here = state === "synced";
  const kind = row ? sourceKindOf(row) : null;
  const engineTargets = row ? relevantTargets(row, targets) : [];
  const hiddenCount = targets.length - engineTargets.length;
  const unavailable = Boolean(usageError);
  const maker = skillMaker(entry);
  const contentError = content.error
    ? (content.error as { code?: string }).code === "not_found" && !row
      ? t("discover.contentMissing")
      : row
        ? content.error instanceof Error
          ? content.error.message
          : String(content.error)
        : t("discover.contentFailed")
    : null;

  const facts: StoreFact[] = row
    ? [
        { label: "Source", value: t(`source.${kind}`) },
        {
          label: "Engines",
          value: String(
            engineTargets.filter((info) => row.targetStates?.[info.id] === "synced").length,
          ),
        },
        {
          label: t("detail.invocations"),
          value: usageLoading ? (
            <Skeleton className="h-4 w-8" />
          ) : unavailable ? (
            "—"
          ) : (
            String(usage?.invocations ?? 0)
          ),
        },
        {
          label: t("detail.lastUsed"),
          value: usageLoading ? (
            <Skeleton className="h-4 w-16" />
          ) : unavailable ? (
            "—"
          ) : (
            lastUsedLabel(usage)
          ),
        },
      ]
    : [
        ...(maker.name ? [{ label: "Maker", value: maker.name }] : []),
        ...(entry.installs ? [{ label: "Installs", value: compact.format(entry.installs) }] : []),
        ...(entry.repo ? [{ label: t("detail.repository"), value: entry.repo }] : []),
      ];

  const primary =
    row && hasUpdate ? (
      <Button
        variant="get-filled"
        icon={RefreshCw}
        disabled={pending}
        onClick={() => onUpdate(row)}
      >
        {t("actions.update")}
      </Button>
    ) : here ? (
      <CatalogDone />
    ) : readonly ? null : (
      <Button
        variant="get-filled"
        icon={Download}
        disabled={pending}
        onClick={() => (row ? onToggleTarget(row, target, true) : onInstall(entry))}
      >
        {state === "orphan" ? "Sync again" : `Install in ${engineName}`}
      </Button>
    );

  return (
    <StoreDetail
      open
      onOpenChange={(open) => !open && onClose()}
      logo={<MakerTile maker={maker} name={entry.name} />}
      title={entry.name}
      line={entry.description || row?.directory}
      action={primary}
      menu={
        (row && !readonly) || link ? (
          <>
            {link ? (
              <MenuItem
                icon={ExternalLink}
                label="Open its page"
                onSelect={() => openExternalLink(link)}
              />
            ) : null}
            {row && !row.managed && !readonly ? (
              <MenuItem
                icon={FolderInput}
                label={t("actions.import")}
                disabled={pending}
                onSelect={() => onImport(row)}
              />
            ) : null}
            {row && !readonly ? (
              <MenuItem
                icon={Trash2}
                label={row.managed ? "Remove from every engine" : t("actions.deleteLocal")}
                danger
                disabled={pending}
                onSelect={() => (row.managed ? onUninstall(row) : onDeleteLocal(row))}
              />
            ) : null}
          </>
        ) : undefined
      }
      facts={facts}
    >
      <StoreDetailSection title="About">
        {row && (unavailable || (!usageLoading && !usage?.invocations)) ? (
          <Text as="p" size="meta" tone="muted" wrap className="m-0">
            {unavailable ? t("detail.usageUnavailable") : t("detail.unusedHint")}
          </Text>
        ) : null}
        <PropertyList
          label="Where it is"
          items={[
            ...(entry.repo && link
              ? [
                  {
                    label: t("detail.repository"),
                    value: (
                      <InlineLink onClick={() => openExternalLink(link)}>{entry.repo}</InlineLink>
                    ),
                    full: entry.repo,
                  },
                ]
              : []),
            ...(row ? [{ label: t("detail.directory"), value: row.directory }] : []),
            ...Object.entries(row?.targetPaths ?? {}).map(([id, path]) => ({
              id: `copy:${id}`,
              label: targets.find((info) => info.id === id)?.label ?? id,
              value: path,
            })),
          ]}
        />
      </StoreDetailSection>

      {row ? (
        <StoreDetailSection title={t("detail.syncTo")}>
          <ul className="m-0 grid list-none p-0">
            {engineTargets.map((info) => {
              const copy = row.targetStates?.[info.id] ?? "off";
              const locked = !row.managed && copy === "synced";
              return (
                <li key={info.id}>
                  <ListRow
                    label={info.label}
                    leading={<EngineGlyph engine={info.id} label={info.label} />}
                    description={locked ? t("row.localCopyLocked") : t(`targetStateShort.${copy}`)}
                    trailing={
                      <Checkbox
                        aria-label={t(`targetState.${copy}`, { engine: info.label })}
                        checked={copy === "synced"}
                        disabled={readonly || pending || busyTarget === info.id || locked}
                        onCheckedChange={(next) =>
                          onToggleTarget(row, info.id as SkillTargetId, next === true)
                        }
                      />
                    }
                  />
                </li>
              );
            })}
          </ul>
          {hiddenCount > 0 || readonly || !row.managed ? (
            <Text as="p" size="meta" tone="muted" wrap className="m-0">
              {[
                hiddenCount > 0
                  ? `${hiddenCount} more engines aren't installed; they show here once they are.`
                  : "",
                readonly && kind ? t(`readonly.${kind}`) : "",
                !row.managed && !readonly ? t("detail.promoteHint") : "",
              ]
                .filter(Boolean)
                .join(" ")}
            </Text>
          ) : null}
        </StoreDetailSection>
      ) : null}

      <StoreDetailSection title="SKILL.md">
        <SkillMarkdown
          loading={content.loading}
          error={contentError}
          content={content.data ?? null}
          loadingLabel={row ? t("detail.contentLoading") : t("discover.contentLoading")}
          failed={
            <ErrorState
              inline
              title="SKILL.md couldn't be read"
              line={contentError ?? ""}
              action={{ label: t("discover.retry"), onClick: () => void content.reload() }}
            />
          }
        />
      </StoreDetailSection>
    </StoreDetail>
  );
}
