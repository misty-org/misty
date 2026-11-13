// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
/**
 * Discovery pane data source: repos, repo-hosted discovery, skills.sh search
 * and popular. Online requests fire only while the pane is active and the
 * user asks for them (enter/refresh) — never on settings open.
 *
 * The popular ranking, the repository scan and the repository list are kept in the shared cache
 * (and on this computer between launches): reopening the pane paints the last copy at once and
 * reads again behind it, so only a first visit with nothing saved shows a skeleton. Search
 * results are the person's own query and are never kept.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { refreshCachedResource, useCachedResource } from "@/api/cache/cached-resource";
import { skillsHubApi } from "./api";
import type { DiscoveredSkill, SkillRepo, SkillTargetId } from "./types";

/** Cache keys, one per list, shared by every reader on this computer. */
const POPULAR_KEY = "engine-skills/popular";
const REPO_SKILLS_KEY = "engine-skills/discover";
const REPOS_KEY = "engine-skills/repos";

type DiscoverSource = "popular" | "repos";

const loadPopularList = () => skillsHubApi.popular(false);
const loadRepoSkills = () => skillsHubApi.discover(false);
const loadRepoList = async () => (await skillsHubApi.repos()).repos ?? [];

const errorText = (error: unknown) =>
  error == null ? null : error instanceof Error ? error.message : String(error);

const NO_SKILLS: DiscoveredSkill[] = [];
const NO_REPOS: SkillRepo[] = [];

interface SkillDiscoveryStore {
  repos: SkillRepo[];
  /** Nothing to show yet and the first read is under way. */
  reposLoading: boolean;
  discover: DiscoveredSkill[];
  /** Nothing to show yet and the first read is under way. */
  discoverLoading: boolean;
  discoverError: string | null;
  discoverCached: boolean;
  generatedAt: number | null;
  query: string;
  setQuery: (value: string) => void;
  searchResults: DiscoveredSkill[] | null;
  searchLoading: boolean;
  searchError: string | null;
  totalCount: number;
  runSearch: (query: string) => Promise<void>;
  loadPopular: (force?: boolean) => Promise<void>;
  loadDiscover: (force?: boolean) => Promise<void>;
  addRepo: (repo: { owner: string; name: string; branch: string }) => Promise<void>;
  removeRepo: (owner: string, name: string) => Promise<void>;
  install: (skill: DiscoveredSkill, targets: SkillTargetId[]) => Promise<void>;
  installingKey: string | null;
}

export function useSkillDiscovery(active: boolean): SkillDiscoveryStore {
  // Which list the browse view shows. The repository scan is read only once it is asked for,
  // because it hits every configured repository.
  const [source, setSource] = useState<DiscoverSource>("popular");
  const popular = useCachedResource(active ? POPULAR_KEY : null, loadPopularList, {
    persist: "device",
  });
  const scanned = useCachedResource(
    active && source === "repos" ? REPO_SKILLS_KEY : null,
    loadRepoSkills,
    { persist: "device" },
  );
  const repoList = useCachedResource(active ? REPOS_KEY : null, loadRepoList, {
    persist: "device",
  });
  const current = source === "popular" ? popular : scanned;

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<DiscoveredSkill[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [installingKey, setInstallingKey] = useState<string | null>(null);

  const sequence = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current += 1;
    };
  }, []);

  // Showing a list leaves any search. A forced read skips the native cache; either way the list
  // on screen stays until it answers, and a failure is kept beside it (`discoverError`).
  const loadPopular = useCallback(async (force?: boolean) => {
    sequence.current += 1;
    setSource("popular");
    setSearchResults(null);
    if (!force) return;
    await refreshCachedResource(POPULAR_KEY, () => skillsHubApi.popular(true), "device").catch(
      () => {},
    );
  }, []);

  const loadDiscover = useCallback(async (force?: boolean) => {
    sequence.current += 1;
    setSource("repos");
    setSearchResults(null);
    if (!force) return;
    await refreshCachedResource(REPO_SKILLS_KEY, () => skillsHubApi.discover(true), "device").catch(
      () => {},
    );
  }, []);

  const runSearch = useCallback(async (needle: string) => {
    const current = sequence.current + 1;
    sequence.current = current;
    const canCommit = () => mounted.current && sequence.current === current;
    setSearchLoading(true);
    setSearchError(null);
    try {
      const payload = await skillsHubApi.search(needle);
      if (!canCommit()) return;
      setSearchResults(payload.skills ?? []);
      setTotalCount(payload.totalCount ?? 0);
    } catch (error) {
      if (!canCommit()) return;
      setSearchError(error instanceof Error ? error.message : String(error));
      setSearchResults([]);
    } finally {
      setSearchLoading((value) => (canCommit() ? false : value));
    }
  }, []);

  // A change is followed by a fresh read of the list, never one that began before it landed.
  const setRepoList = repoList.set;
  const addRepo = useCallback(
    async (repo: { owner: string; name: string; branch: string }) => {
      await skillsHubApi.addRepo(repo);
      setRepoList(await loadRepoList());
      setSearchResults(null);
    },
    [setRepoList],
  );

  const removeRepo = useCallback(
    async (owner: string, name: string) => {
      await skillsHubApi.removeRepo(owner, name);
      setRepoList(await loadRepoList());
    },
    [setRepoList],
  );

  const install = useCallback(async (skill: DiscoveredSkill, targets: SkillTargetId[]) => {
    setInstallingKey(skill.key);
    try {
      await skillsHubApi.install(skill, targets);
    } finally {
      if (mounted.current) setInstallingKey(null);
    }
  }, []);

  return {
    repos: repoList.data ?? NO_REPOS,
    reposLoading: repoList.loading,
    discover: current.data?.skills ?? NO_SKILLS,
    discoverLoading: current.loading,
    discoverError: errorText(current.error),
    discoverCached: current.data?.cached ?? false,
    generatedAt: current.data?.generatedAt ?? null,
    query,
    setQuery,
    searchResults,
    searchLoading,
    searchError,
    totalCount,
    runSearch,
    loadPopular,
    loadDiscover,
    addRepo,
    removeRepo,
    install,
    installingKey,
  };
}
