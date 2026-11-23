// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
import { useCallback, useEffect, useRef, useState } from "react";
import { refreshCachedResource, useCachedResource } from "@/api/cache/cached_resource";
import { skillsHubApi } from "./api";
import type { DiscoveredSkill, SkillRepo, SkillTargetId } from "./types";

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
  reposLoading: boolean;
  discover: DiscoveredSkill[];
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
