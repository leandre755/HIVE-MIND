import type React from 'react';
import type { HiveConfig } from '../../../config/hiveConfig.js';
import type { SessionInfo } from '../../../utils/sessionUtils.js';

export type SessionSortOrder = 'date' | 'messages' | 'name';

export interface SessionBrowserProps {
  config: HiveConfig;
  onResumeSession: (session: SessionInfo) => void;
  onDeleteSession: (session: SessionInfo) => Promise<void>;
  onExit: () => void;
}

export interface SessionBrowserState {
  sessions: SessionInfo[];
  filteredAndSortedSessions: SessionInfo[];

  loading: boolean;
  error: string | null;
  activeIndex: number;
  scrollOffset: number;
  terminalHeight: number;
  terminalWidth: number;

  searchQuery: string;
  isSearchMode: boolean;
  hasLoadedFullContent: boolean;

  sortOrder: SessionSortOrder;
  sortReverse: boolean;

  totalSessions: number;
  startIndex: number;
  endIndex: number;
  visibleSessions: SessionInfo[];

  setSessions: React.Dispatch<React.SetStateAction<SessionInfo[]>>;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveIndex: React.Dispatch<React.SetStateAction<number>>;
  setScrollOffset: React.Dispatch<React.SetStateAction<number>>;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  setIsSearchMode: React.Dispatch<React.SetStateAction<boolean>>;
  setSortOrder: React.Dispatch<React.SetStateAction<'date' | 'messages' | 'name'>>;
  setSortReverse: React.Dispatch<React.SetStateAction<boolean>>;
  setHasLoadedFullContent: React.Dispatch<React.SetStateAction<boolean>>;
}
