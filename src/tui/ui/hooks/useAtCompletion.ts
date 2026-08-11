import { useCallback, useEffect, useReducer, useRef } from 'react';
import { setTimeout as setTimeoutPromise } from 'node:timers/promises';
import * as path from 'node:path';
import { HiveConfig } from '../../config/hiveConfig.js';
import {
  FileSearchFactory,
  escapePath,
  FileDiscoveryService,
  FileSearch,
  CommandKind,
} from '../contexts/UIStateContext.js';
import { MAX_SUGGESTIONS_TO_SHOW, type Suggestion } from '../components/SuggestionsDisplay.js';
import { AsyncFzf } from 'fzf';

const DEFAULT_SEARCH_TIMEOUT_MS = 5000;

export enum AtCompletionStatus {
  IDLE = 'idle',
  INITIALIZING = 'initializing',
  READY = 'ready',
  SEARCHING = 'searching',
  ERROR = 'error',
}

interface AtCompletionState {
  status: AtCompletionStatus;
  suggestions: Suggestion[];
  isLoading: boolean;
  pattern: string | null;
}

type AtCompletionAction =
  | { type: 'INITIALIZE' }
  | { type: 'INITIALIZE_SUCCESS' }
  | { type: 'SEARCH'; payload: string }
  | { type: 'SEARCH_SUCCESS'; payload: Suggestion[] }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'ERROR' }
  | { type: 'RESET' };

const initialState: AtCompletionState = {
  status: AtCompletionStatus.IDLE,
  suggestions: [],
  isLoading: false,
  pattern: null,
};

function atCompletionReducer(
  state: AtCompletionState,
  action: AtCompletionAction,
): AtCompletionState {
  switch (action.type) {
    case 'INITIALIZE':
      return {
        ...state,
        status: AtCompletionStatus.INITIALIZING,
        isLoading: true,
      };
    case 'INITIALIZE_SUCCESS':
      return { ...state, status: AtCompletionStatus.READY, isLoading: false };
    case 'SEARCH':
      // Keep old suggestions, don't set loading immediately
      return {
        ...state,
        status: AtCompletionStatus.SEARCHING,
        pattern: action.payload,
      };
    case 'SEARCH_SUCCESS':
      return {
        ...state,
        status: AtCompletionStatus.READY,
        suggestions: action.payload,
        isLoading: false,
      };
    case 'SET_LOADING':
      // Only show loading if we are still in a searching state
      if (state.status === AtCompletionStatus.SEARCHING) {
        return { ...state, isLoading: action.payload, suggestions: [] };
      }
      return state;
    case 'ERROR':
      return {
        ...state,
        status: AtCompletionStatus.ERROR,
        isLoading: false,
        suggestions: [],
      };
    case 'RESET':
      return initialState;
    default:
      return state;
  }
}

export interface UseAtCompletionProps {
  enabled: boolean;
  pattern: string;
  config: HiveConfig | undefined;
  cwd: string;
  setSuggestions: (suggestions: Suggestion[]) => void;
  setIsLoadingSuggestions: (isLoading: boolean) => void;
}

interface ResourceSuggestionCandidate {
  searchKey: string;
  suggestion: Suggestion;
}

interface IResourceRegistry {
  getAllResources(): Array<{ serverName: string; uri: string; name?: string }>;
}

interface IAgentRegistry {
  getAllDefinitions(): Array<{ name: string }>;
}

interface IWorkspaceContext {
  getDirectories(): string[];
  onDirectoriesChanged?(callback: () => void): () => void;
}

interface IFileSearch {
  initialize(): Promise<void>;
  close?(): Promise<void>;
  search(pattern: string, options: { signal: AbortSignal; maxResults: number }): Promise<string[]>;
}

interface IConfigFuzzy {
  getFileFilteringEnableFuzzySearch?(): boolean;
}

function buildResourceCandidates(config?: HiveConfig): ResourceSuggestionCandidate[] {
  const registry = config?.getResourceRegistry?.() as unknown as IResourceRegistry | undefined;
  if (!registry) {
    return [];
  }

  const resources = registry.getAllResources().map((resource) => {
    // Use serverName:uri format to disambiguate resources from different MCP servers
    const prefixedUri = `${resource.serverName}:${resource.uri}`;
    return {
      // Include prefixedUri in searchKey so users can search by the displayed format
      searchKey: `${prefixedUri} ${resource.name ?? ''}`.toLowerCase(),
      suggestion: {
        label: prefixedUri,
        value: prefixedUri,
      },
    } satisfies ResourceSuggestionCandidate;
  });

  return resources;
}

function buildAgentCandidates(config?: HiveConfig): Suggestion[] {
  const registry = config?.getAgentRegistry?.() as unknown as IAgentRegistry | undefined;
  if (!registry) {
    return [];
  }
  return registry.getAllDefinitions().map((def) => ({
    label: def.name,
    value: def.name,
    commandKind: CommandKind.AGENT,
  }));
}

async function searchResourceCandidates(
  pattern: string,
  candidates: ResourceSuggestionCandidate[],
): Promise<Suggestion[]> {
  if (candidates.length === 0) {
    return [];
  }

  const normalizedPattern = pattern.toLowerCase();
  if (!normalizedPattern) {
    return candidates.slice(0, MAX_SUGGESTIONS_TO_SHOW).map((candidate) => candidate.suggestion);
  }

  const fzf = new AsyncFzf(candidates, {
    selector: (candidate: ResourceSuggestionCandidate) => candidate.searchKey,
  });

  const results = await (
    fzf as unknown as {
      find: (
        p: string,
        o: { limit: number },
      ) => Promise<Array<{ item: ResourceSuggestionCandidate }>>;
    }
  ).find(normalizedPattern, {
    limit: MAX_SUGGESTIONS_TO_SHOW * 3,
  });
  return results.map((result) => result.item.suggestion);
}

async function searchAgentCandidates(
  pattern: string,
  candidates: Suggestion[],
): Promise<Suggestion[]> {
  if (candidates.length === 0) {
    return [];
  }
  const normalizedPattern = pattern.toLowerCase();
  if (!normalizedPattern) {
    return candidates.slice(0, MAX_SUGGESTIONS_TO_SHOW);
  }
  const fzf = new AsyncFzf(candidates, {
    selector: (s: Suggestion) => s.label,
  });

  const results = await (
    fzf as unknown as {
      find: (p: string, o: { limit: number }) => Promise<Array<{ item: Suggestion }>>;
    }
  ).find(normalizedPattern, {
    limit: MAX_SUGGESTIONS_TO_SHOW,
  });
  return results.map((r) => r.item);
}

async function initializeFileSearchers(
  config: HiveConfig | undefined,
  cwd: string,
  fileSearchMap: React.MutableRefObject<Map<string, FileSearch>>,
  initEpoch: React.MutableRefObject<number>,
): Promise<boolean> {
  const currentEpoch = initEpoch.current;
  const workspaceContext = config?.getWorkspaceContext?.() as unknown as
    IWorkspaceContext | undefined;
  const directories = workspaceContext?.getDirectories() ?? [cwd];
  const initPromises: Array<Promise<void>> = [];

  for (const dir of directories) {
    if (fileSearchMap.current.has(dir)) continue;
    const searcher = FileSearchFactory.create({
      projectRoot: dir,
      ignoreDirs: [],
      fileDiscoveryService: new FileDiscoveryService(dir, config?.getFileFilteringOptions()),
      cache: true,
      cacheTtl: 30,
      enableFileWatcher: config?.getFileFilteringOptions()?.enableFileWatcher ?? false,
      enableRecursiveFileSearch: config?.getEnableRecursiveFileSearch() ?? true,
      enableFuzzySearch:
        (config as unknown as IConfigFuzzy)?.getFileFilteringEnableFuzzySearch?.() ?? true,
      maxFiles: config?.getFileFilteringOptions()?.maxFileCount,
    });
    initPromises.push(
      (searcher as unknown as IFileSearch).initialize().then(() => {
        if (initEpoch.current === currentEpoch) {
          fileSearchMap.current.set(dir, searcher);
        }
      }),
    );
  }

  await Promise.all(initPromises);
  return initEpoch.current === currentEpoch;
}

async function executeFileSearch(
  dir: string,
  searcher: IFileSearch,
  pattern: string,
  cwdRealpath: string,
  controller: AbortController,
): Promise<string[]> {
  const results = await searcher.search(pattern, {
    signal: controller.signal,
    maxResults: MAX_SUGGESTIONS_TO_SHOW * 3,
  });

  if (dir !== cwdRealpath) {
    return results.map((p) => path.join(dir, p));
  }
  return results;
}

export function useAtCompletion(props: UseAtCompletionProps): void {
  const { enabled, pattern, config, cwd, setSuggestions, setIsLoadingSuggestions } = props;
  const [state, dispatch] = useReducer(atCompletionReducer, initialState);
  const fileSearchMap = useRef<Map<string, FileSearch>>(new Map());
  const initEpoch = useRef(0);
  const searchAbortController = useRef<AbortController | null>(null);
  const slowSearchTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setSuggestions(state.suggestions);
  }, [state.suggestions, setSuggestions]);

  useEffect(() => {
    setIsLoadingSuggestions(state.isLoading);
  }, [state.isLoading, setIsLoadingSuggestions]);

  const disposeFileSearchers = useCallback(async () => {
    const searchers = [...fileSearchMap.current.values()];
    fileSearchMap.current.clear();
    initEpoch.current += 1;

    const closePromises: Array<Promise<void>> = [];
    for (const searcher of searchers) {
      const searcherClose = (searcher as unknown as IFileSearch).close;
      if (searcherClose) {
        closePromises.push(searcherClose.call(searcher));
      }
    }
    await Promise.all(closePromises);
  }, []);

  const resetFileSearchState = useCallback(() => {
    void disposeFileSearchers();
    dispatch({ type: 'RESET' });
  }, [disposeFileSearchers]);

  useEffect(() => {
    resetFileSearchState();
  }, [cwd, config, resetFileSearchState]);

  useEffect(() => {
    const workspaceContext = config?.getWorkspaceContext?.() as unknown as
      IWorkspaceContext | undefined;
    if (!workspaceContext || typeof workspaceContext.onDirectoriesChanged !== 'function') return;

    const unsubscribe = workspaceContext.onDirectoriesChanged(resetFileSearchState);
    return unsubscribe;
  }, [config, resetFileSearchState]);

  useEffect(
    () => () => {
      void disposeFileSearchers();
      searchAbortController.current?.abort();
      if (slowSearchTimer.current) {
        clearTimeout(slowSearchTimer.current);
      }
    },
    [disposeFileSearchers],
  );

  // Reacts to user input (`pattern`) ONLY.
  useEffect(() => {
    if (!enabled) {
      // reset when first getting out of completion suggestions
      if (state.status === AtCompletionStatus.READY || state.status === AtCompletionStatus.ERROR) {
        dispatch({ type: 'RESET' });
      }
      return;
    }
    if (pattern === null) {
      dispatch({ type: 'RESET' });
      return;
    }

    if (state.status === AtCompletionStatus.IDLE) {
      dispatch({ type: 'INITIALIZE' });
    } else if (
      (state.status === AtCompletionStatus.READY ||
        state.status === AtCompletionStatus.SEARCHING) &&
      pattern.toLowerCase() !== state.pattern // Only search if the pattern has changed
    ) {
      dispatch({ type: 'SEARCH', payload: pattern.toLowerCase() });
    }
  }, [enabled, pattern, state.status, state.pattern]);

  // The "Worker" that performs async operations based on status.
  useEffect(() => {
    const initialize = async () => {
      const currentEpoch = initEpoch.current;
      try {
        const isValid = await initializeFileSearchers(config, cwd, fileSearchMap, initEpoch);
        if (!isValid) return;
        dispatch({ type: 'INITIALIZE_SUCCESS' });
        if (state.pattern !== null) {
          dispatch({ type: 'SEARCH', payload: state.pattern });
        }
      } catch {
        if (initEpoch.current === currentEpoch) {
          dispatch({ type: 'ERROR' });
        }
      }
    };

    const search = async () => {
      if (fileSearchMap.current.size === 0 || state.pattern === null) {
        return;
      }

      const currentPattern = state.pattern;

      if (slowSearchTimer.current) {
        clearTimeout(slowSearchTimer.current);
      }

      const controller = new AbortController();
      searchAbortController.current = controller;

      slowSearchTimer.current = setTimeout(() => {
        dispatch({ type: 'SET_LOADING', payload: true });
      }, 200);

      const timeoutMs =
        config?.getFileFilteringOptions()?.searchTimeout ?? DEFAULT_SEARCH_TIMEOUT_MS;

      (async () => {
        try {
          await setTimeoutPromise(timeoutMs, undefined, {
            signal: controller.signal,
          });
          controller.abort();
        } catch {
          // ignore
        }
      })();

      try {
        const workspaceContext = config?.getWorkspaceContext?.() as unknown as
          IWorkspaceContext | undefined;
        const directories = workspaceContext?.getDirectories() ?? [cwd];
        const cwdRealpath = directories[0];

        const allSearchPromises = [...fileSearchMap.current.entries()].map(([dir, searcher]) =>
          executeFileSearch(
            dir,
            searcher as unknown as IFileSearch,
            currentPattern,
            cwdRealpath || cwd,
            controller,
          ),
        );

        const allResults = await Promise.all(allSearchPromises);

        if (slowSearchTimer.current) {
          clearTimeout(slowSearchTimer.current);
        }

        if (controller.signal.aborted) {
          return;
        }

        const mergedResults = allResults.flat();

        const fileSuggestions = mergedResults.map((p) => ({
          label: p,
          value: escapePath(p),
        }));

        const resourceCandidates = buildResourceCandidates(config);
        const resourceSuggestions = (
          await searchResourceCandidates(currentPattern ?? '', resourceCandidates)
        ).map((suggestion) => ({
          ...suggestion,
          label: suggestion.label.replace(/^@/, ''),
          value: suggestion.value.replace(/^@/, ''),
        }));

        const agentCandidates = buildAgentCandidates(config);
        const agentSuggestions = await searchAgentCandidates(currentPattern ?? '', agentCandidates);

        // Re-check after resource/agent searches which are not abort-aware
        if (controller.signal.aborted) {
          return;
        }

        const combinedSuggestions = [
          ...agentSuggestions,
          ...fileSuggestions,
          ...resourceSuggestions,
        ];
        dispatch({ type: 'SEARCH_SUCCESS', payload: combinedSuggestions });
      } catch (error) {
        if (!(error instanceof Error && error.name === 'AbortError')) {
          dispatch({ type: 'ERROR' });
        }
      } finally {
        controller.abort();
      }
    };

    if (state.status === AtCompletionStatus.INITIALIZING) {
      initialize();
    } else if (state.status === AtCompletionStatus.SEARCHING) {
      search();
    }

    return () => {
      searchAbortController.current?.abort();
      if (slowSearchTimer.current) {
        clearTimeout(slowSearchTimer.current);
      }
    };
  }, [state.status, state.pattern, config, cwd]);
}
