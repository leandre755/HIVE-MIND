import { useState, useEffect, useMemo, useRef } from 'react';
import { AsyncFzf } from 'fzf';
import type { Suggestion } from '../components/SuggestionsDisplay.js';
import { CommandKind, CommandContext, SlashCommand } from '../contexts/UIStateContext.js';
import { debugLogger } from '../../utils/errors.js';

// Interface for FZF command cache entry
interface FzfCommandCacheEntry {
  fzf: AsyncFzf<string[]>;
  commandMap: Map<string, SlashCommand>;
}

// Utility function to safely handle errors without information disclosure
function logErrorSafely(error: unknown, context: string): void {
  if (error instanceof Error) {
    // Log full error details securely for debugging
    debugLogger.warn(`[${context}]`, error);
  } else {
    debugLogger.warn(`[${context}] Non-error thrown:`, error);
  }
}

// Shared utility function for command matching logic
function matchesCommand(cmd: SlashCommand, query: string): boolean {
  return (
    cmd.name.toLowerCase() === query.toLowerCase() ||
    cmd.altNames?.some((alt) => alt.toLowerCase() === query.toLowerCase()) ||
    false
  );
}

interface CommandParserResult {
  hasTrailingSpace: boolean;
  commandPathParts: string[];
  partial: string;
  currentLevel: readonly SlashCommand[] | undefined;
  leafCommand: SlashCommand | null;
  isArgumentCompletion: boolean;
}

function useCommandParser(
  query: string | null,
  slashCommands: readonly SlashCommand[],
): CommandParserResult {
  return useMemo(() => {
    if (!query) {
      return {
        hasTrailingSpace: false,
        commandPathParts: [],
        partial: '',
        currentLevel: slashCommands,
        leafCommand: null,
        isArgumentCompletion: false,
      };
    }

    const fullPath = query.substring(1) || '';
    const hasTrailingSpace = !!query.endsWith(' ');
    const rawParts = fullPath.split(/\s+/).filter((p) => p);
    let commandPathParts = rawParts;
    let partial = '';

    if (!hasTrailingSpace && rawParts.length > 0) {
      partial = rawParts[rawParts.length - 1];
      commandPathParts = rawParts.slice(0, -1);
    }

    let currentLevel: readonly SlashCommand[] | undefined = slashCommands;
    let leafCommand: SlashCommand | null = null;

    for (const part of commandPathParts) {
      if (!currentLevel) {
        leafCommand = null;
        currentLevel = [];
        break;
      }
      const found: SlashCommand | undefined = currentLevel.find((cmd) => matchesCommand(cmd, part));

      if (found) {
        leafCommand = found;
        currentLevel = found.subCommands as readonly SlashCommand[] | undefined;
        if (found.kind === CommandKind.MCP_PROMPT) {
          break;
        }
      } else {
        leafCommand = null;
        currentLevel = [];
        break;
      }
    }

    const depth = commandPathParts.length;
    const isArgumentCompletion = !!(
      leafCommand?.completion &&
      (hasTrailingSpace || (rawParts.length > depth && depth > 0 && partial !== ''))
    );

    return {
      hasTrailingSpace,
      commandPathParts,
      partial,
      currentLevel,
      leafCommand,
      isArgumentCompletion,
    };
  }, [query, slashCommands]);
}

function getCommandRelevanceRank(cmd: SlashCommand, lowerPartial: string): number {
  if (cmd.name.toLowerCase() === lowerPartial) return 4;
  if (cmd.altNames?.some((alt) => alt.toLowerCase() === lowerPartial)) return 3;
  if (cmd.name.toLowerCase().startsWith(lowerPartial)) return 2;
  if (cmd.altNames?.some((alt) => alt.toLowerCase().startsWith(lowerPartial))) return 1;
  return 0;
}

function sortSuggestionsByRelevance(
  suggestions: SlashCommand[],
  lowerPartial: string,
): SlashCommand[] {
  return [...suggestions].sort(
    (a, b) => getCommandRelevanceRank(b, lowerPartial) - getCommandRelevanceRank(a, lowerPartial),
  );
}

function areSuggestionsEqual(a: Suggestion[], b: Suggestion[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, i) => item.label === b.at(i)?.label && item.value === b.at(i)?.value);
}

function commandMatchesPrefix(cmd: SlashCommand, lowerPartial: string): boolean {
  if (!cmd.description || cmd.hidden) return false;
  if (cmd.name.toLowerCase().startsWith(lowerPartial)) return true;
  return cmd.altNames?.some((alt) => alt.toLowerCase().startsWith(lowerPartial)) ?? false;
}

function getPrefixSuggestions(commands: readonly SlashCommand[], partial: string): SlashCommand[] {
  const lowerPartial = partial.toLowerCase();
  return commands.filter((cmd) => commandMatchesPrefix(cmd, lowerPartial));
}

async function findPotentialSuggestions(
  commandsToSearch: readonly SlashCommand[],
  partial: string,
  getFzfForCommands: (commands: readonly SlashCommand[]) => FzfCommandCacheEntry | null,
  signal: AbortSignal,
): Promise<SlashCommand[]> {
  if (partial === '') {
    return commandsToSearch.filter((cmd) => cmd.description && !cmd.hidden);
  }

  const fzfInstance = getFzfForCommands(commandsToSearch);
  if (!fzfInstance) {
    return getPrefixSuggestions(commandsToSearch, partial);
  }

  try {
    const fzfResults = await fzfInstance.fzf.find(partial);
    if (signal.aborted) return [];
    const uniqueCommands = new Set<SlashCommand>();
    for (const result of fzfResults) {
      const cmd = fzfInstance.commandMap.get(result.item);
      if (cmd?.description) {
        uniqueCommands.add(cmd);
      }
    }
    return Array.from(uniqueCommands);
  } catch (error) {
    logErrorSafely(error, 'Fuzzy search - falling back to prefix matching');
    return getPrefixSuggestions(commandsToSearch, partial);
  }
}

function buildFinalSuggestions(
  potentialSuggestions: SlashCommand[],
  partial: string,
  leafCommand: SlashCommand | null,
  commandPathParts: string[],
): Suggestion[] {
  const lowerPartial = partial.toLowerCase();
  const sortedSuggestions = sortSuggestionsByRelevance(potentialSuggestions, lowerPartial);

  const finalSuggestions = sortedSuggestions.map((cmd) => {
    const suggestion: Suggestion = {
      label: cmd.name,
      value: cmd.name,
      description: cmd.description,
      commandKind: cmd.kind,
    };

    if (cmd.suggestionGroup) {
      suggestion.sectionTitle = cmd.suggestionGroup;
    }

    return suggestion;
  });

  const isTopLevelChatOrResumeContext = !!(
    leafCommand &&
    (leafCommand.name === 'chat' || leafCommand.name === 'resume') &&
    (commandPathParts.length === 0 ||
      (commandPathParts.length === 1 && matchesCommand(leafCommand, commandPathParts[0])))
  );

  if (isTopLevelChatOrResumeContext) {
    const canonicalParentName = leafCommand.name;
    const autoLabel = 'list';
    if (partial === '' || autoLabel.toLowerCase().startsWith(lowerPartial)) {
      const autoSectionSuggestion: Suggestion = {
        label: autoLabel,
        value: autoLabel,
        insertValue: canonicalParentName,
        description: 'Browse auto-saved chats',
        commandKind: CommandKind.BUILT_IN,
        sectionTitle: 'auto',
        submitValue: `/${canonicalParentName}`,
      };
      return [autoSectionSuggestion, ...finalSuggestions];
    }
  }

  return finalSuggestions;
}

interface SuggestionsResult {
  suggestions: Suggestion[];
  isLoading: boolean;
}

interface CompletionPositions {
  start: number;
  end: number;
}

interface PerfectMatchResult {
  isPerfectMatch: boolean;
}

function useCommandSuggestions(
  query: string | null,
  parserResult: CommandParserResult,
  commandContext: CommandContext,
  getFzfForCommands: (commands: readonly SlashCommand[]) => FzfCommandCacheEntry | null,
): SuggestionsResult {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Store commandContext in a ref to avoid it being a useEffect dependency.
  // commandContext changes reference on every render due to upstream useMemo
  // instability, but we only read it inside the async completion callback.
  const commandContextRef = useRef(commandContext);
  commandContextRef.current = commandContext;

  useEffect(() => {
    if (query === null) {
      setSuggestions((prev) => (prev.length === 0 ? prev : []));
      setIsLoading((prev) => (prev ? false : prev));
      return undefined;
    }

    const abortController = new AbortController();
    const { signal } = abortController;

    const { isArgumentCompletion, leafCommand, commandPathParts, partial, currentLevel } =
      parserResult;

    if (isArgumentCompletion) {
      const fetchAndSetSuggestions = async () => {
        if (signal.aborted) return;

        // Safety check: ensure leafCommand and completion exist
        if (!leafCommand?.completion) {
          debugLogger.warn('Attempted argument completion without completion function');
          return;
        }

        const showLoading = leafCommand.showCompletionLoading !== false;
        if (showLoading) {
          setIsLoading(true);
        }
        try {
          const rawParts = [...commandPathParts];
          if (partial) rawParts.push(partial);
          const depth = commandPathParts.length;
          const argString = rawParts.slice(depth).join(' ');
          const results =
            (await leafCommand.completion(
              {
                ...commandContextRef.current,
                invocation: {
                  raw: query || `/${rawParts.join(' ')}`,
                  name: leafCommand.name,
                  args: argString,
                },
              },
              argString,
            )) || [];

          if (!signal.aborted) {
            const finalSuggestions = results.map((s) => ({
              label: s,
              value: s,
            }));
            setSuggestions((prev) =>
              areSuggestionsEqual(prev, finalSuggestions) ? prev : finalSuggestions,
            );
            setIsLoading((prev) => (prev ? false : prev));
          }
        } catch (error) {
          if (!signal.aborted) {
            logErrorSafely(error, 'Argument completion');
            setSuggestions((prev) => (prev.length === 0 ? prev : []));
            setIsLoading((prev) => (prev ? false : prev));
          }
        }
      };

      fetchAndSetSuggestions();
      return () => abortController.abort();
    }

    const commandsToSearch = currentLevel || [];
    if (commandsToSearch.length > 0) {
      const performFuzzySearch = async () => {
        if (signal.aborted) return;
        const potential = await findPotentialSuggestions(
          commandsToSearch,
          partial,
          getFzfForCommands,
          signal,
        );
        if (signal.aborted) return;
        const finalSuggestions = buildFinalSuggestions(
          potential,
          partial,
          leafCommand,
          commandPathParts,
        );
        setSuggestions(finalSuggestions);
      };

      void (async () => {
        try {
          await performFuzzySearch();
        } catch (error) {
          logErrorSafely(error, 'Unexpected fuzzy search error');
          if (!signal.aborted) {
            setSuggestions((prev) => (prev.length === 0 ? prev : []));
          }
        }
      })();
      return () => abortController.abort();
    }

    setSuggestions((prev) => (prev.length === 0 ? prev : []));
    return () => abortController.abort();
  }, [query, parserResult, getFzfForCommands]);

  return { suggestions, isLoading };
}

function useCompletionPositions(
  query: string | null,
  parserResult: CommandParserResult,
): CompletionPositions {
  return useMemo(() => {
    if (!query) {
      return { start: -1, end: -1 };
    }

    const { hasTrailingSpace, partial } = parserResult;

    // Set completion start/end positions
    if (hasTrailingSpace) {
      return { start: query.length, end: query.length };
    } else if (partial) {
      if (parserResult.isArgumentCompletion) {
        const commandSoFar = `/${parserResult.commandPathParts.join(' ')}`;
        const argStartIndex =
          commandSoFar.length + (parserResult.commandPathParts.length > 0 ? 1 : 0);
        return { start: argStartIndex, end: query.length };
      } else {
        return { start: query.length - partial.length, end: query.length };
      }
    } else {
      return { start: 1, end: query.length };
    }
  }, [query, parserResult]);
}

function usePerfectMatch(parserResult: CommandParserResult): PerfectMatchResult {
  return useMemo(() => {
    const { hasTrailingSpace, partial, leafCommand, currentLevel } = parserResult;

    if (hasTrailingSpace) {
      return { isPerfectMatch: false };
    }

    if (leafCommand && partial === '' && leafCommand.action) {
      return { isPerfectMatch: true };
    }

    if (currentLevel) {
      const perfectMatch = currentLevel.find((cmd) => matchesCommand(cmd, partial) && cmd.action);
      if (perfectMatch) {
        return { isPerfectMatch: true };
      }
    }

    return { isPerfectMatch: false };
  }, [parserResult]);
}

/**
 * Gets the SlashCommand object for a given suggestion by navigating the command hierarchy
 * based on the current parser state.
 * @param suggestion The suggestion object
 * @param parserResult The current parser result with hierarchy information
 * @returns The matching SlashCommand or undefined
 */
function getCommandFromSuggestion(
  suggestion: Suggestion,
  parserResult: CommandParserResult,
): SlashCommand | undefined {
  const { currentLevel } = parserResult;

  if (!currentLevel) {
    return undefined;
  }

  // suggestion.value is just the command name at the current level (e.g., "list")
  // Find it in the current level's commands
  const command = currentLevel.find((cmd) => matchesCommand(cmd, suggestion.value));

  return command;
}

export interface UseSlashCompletionProps {
  enabled: boolean;
  query: string | null;
  slashCommands: readonly SlashCommand[];
  commandContext: CommandContext;
  setSuggestions: (suggestions: Suggestion[]) => void;
  setIsLoadingSuggestions: (isLoading: boolean) => void;
  setIsPerfectMatch: (isMatch: boolean) => void;
}

export function useSlashCompletion(props: UseSlashCompletionProps): {
  completionStart: number;
  completionEnd: number;
  getCommandFromSuggestion: (suggestion: Suggestion) => SlashCommand | undefined;
  isArgumentCompletion: boolean;
  leafCommand: SlashCommand | null;
} {
  const {
    enabled,
    query,
    slashCommands,
    commandContext,
    setSuggestions,
    setIsLoadingSuggestions,
    setIsPerfectMatch,
  } = props;
  const [completionStart, setCompletionStart] = useState(-1);
  const [completionEnd, setCompletionEnd] = useState(-1);

  // Refs to track previously emitted values to external setters,
  // avoiding redundant calls that would trigger parent re-renders.
  const prevExternalSuggestionsRef = useRef<Suggestion[]>([]);
  const prevExternalLoadingRef = useRef(false);
  const prevExternalPerfectMatchRef = useRef(false);

  // Simplified cache for AsyncFzf instances - WeakMap handles automatic cleanup
  const fzfInstanceCache = useMemo(
    () => new WeakMap<readonly SlashCommand[], FzfCommandCacheEntry>(),
    [],
  );

  // Helper function to create or retrieve cached AsyncFzf instance for a command level
  const getFzfForCommands = useMemo(
    () => (commands: readonly SlashCommand[]) => {
      if (!commands || commands.length === 0) {
        return null;
      }

      // Check if we already have a cached instance
      const cached = fzfInstanceCache.get(commands);
      if (cached) {
        return cached;
      }

      // Create new fzf instance
      const commandItems: string[] = [];
      const commandMap = new Map<string, SlashCommand>();

      for (const cmd of commands) {
        if (cmd.description && !cmd.hidden) {
          commandItems.push(cmd.name);
          commandMap.set(cmd.name, cmd);

          if (cmd.altNames) {
            for (const alt of cmd.altNames) {
              commandItems.push(alt);
              commandMap.set(alt, cmd);
            }
          }
        }
      }

      if (commandItems.length === 0) {
        return null;
      }

      try {
        const instance: FzfCommandCacheEntry = {
          fzf: new AsyncFzf(commandItems, {
            fuzzy: 'v2',
            casing: 'case-insensitive', // Explicitly enforce case-insensitivity
          }),
          commandMap,
        };

        // Cache the instance - WeakMap will handle automatic cleanup
        fzfInstanceCache.set(commands, instance);

        return instance;
      } catch (error) {
        logErrorSafely(error, 'FZF instance creation');
        return null;
      }
    },
    [fzfInstanceCache],
  );

  // Use extracted hooks for better separation of concerns
  const parserResult = useCommandParser(query, slashCommands);
  const { suggestions: hookSuggestions, isLoading } = useCommandSuggestions(
    query,
    parserResult,
    commandContext,
    getFzfForCommands,
  );
  const { start: calculatedStart, end: calculatedEnd } = useCompletionPositions(
    query,
    parserResult,
  );
  const { isPerfectMatch } = usePerfectMatch(parserResult);

  // Clear internal state when disabled
  useEffect(() => {
    if (!enabled) {
      if (prevExternalSuggestionsRef.current.length > 0) {
        setSuggestions([]);
        prevExternalSuggestionsRef.current = [];
      }
      if (prevExternalLoadingRef.current) {
        setIsLoadingSuggestions(false);
        prevExternalLoadingRef.current = false;
      }
      if (prevExternalPerfectMatchRef.current) {
        setIsPerfectMatch(false);
        prevExternalPerfectMatchRef.current = false;
      }
      setCompletionStart((prev) => (prev === -1 ? prev : -1));
      setCompletionEnd((prev) => (prev === -1 ? prev : -1));
    }
  }, [enabled, setSuggestions, setIsLoadingSuggestions, setIsPerfectMatch]);

  // Update external state only when enabled
  useEffect(() => {
    if (!enabled || query === null) {
      return;
    }

    // Only call external setters when values actually changed
    if (hookSuggestions !== prevExternalSuggestionsRef.current) {
      setSuggestions(hookSuggestions);
      prevExternalSuggestionsRef.current = hookSuggestions;
    }
    if (isLoading !== prevExternalLoadingRef.current) {
      setIsLoadingSuggestions(isLoading);
      prevExternalLoadingRef.current = isLoading;
    }
    if (isPerfectMatch !== prevExternalPerfectMatchRef.current) {
      setIsPerfectMatch(isPerfectMatch);
      prevExternalPerfectMatchRef.current = isPerfectMatch;
    }
    setCompletionStart((prev) => (prev === calculatedStart ? prev : calculatedStart));
    setCompletionEnd((prev) => (prev === calculatedEnd ? prev : calculatedEnd));
  }, [
    enabled,
    query,
    hookSuggestions,
    isLoading,
    isPerfectMatch,
    calculatedStart,
    calculatedEnd,
    setSuggestions,
    setIsLoadingSuggestions,
    setIsPerfectMatch,
  ]);

  return {
    completionStart,
    completionEnd,
    getCommandFromSuggestion: (suggestion: Suggestion) =>
      getCommandFromSuggestion(suggestion, parserResult),
    isArgumentCompletion: parserResult.isArgumentCompletion,
    leafCommand: parserResult.leafCommand,
  };
}
