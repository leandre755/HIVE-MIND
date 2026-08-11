import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from 'react';
import { getBoundingBox, type DOMElement } from 'ink';
import { useMouse, type MouseEvent } from '../hooks/useMouse.js';
import { terminalCapabilityManager } from '../utils/terminalCapabilityManager.js';

export interface ScrollState {
  scrollTop: number;
  scrollHeight: number;
  innerHeight: number;
}

export interface ScrollableEntry {
  id: string;
  ref: React.RefObject<DOMElement>;
  getScrollState: () => ScrollState;
  scrollBy: (delta: number) => void;
  scrollTo?: (scrollTop: number, duration?: number) => void;
  hasFocus: () => boolean;
  flashScrollbar: () => void;
}

interface ScrollContextType {
  register: (entry: ScrollableEntry) => void;
  unregister: (id: string) => void;
}

const ScrollContext = createContext<ScrollContextType | null>(null);

/**
 * The minimum fractional scroll delta to track.
 */
const SCROLL_STATIC_FRICTION = 0.001;

/**
 * Calculates a scroll top value clamped between 0 and the maximum possible
 * scroll position for the given container dimensions.
 */
const getClampedScrollTop = (scrollTop: number, scrollHeight: number, innerHeight: number) => {
  const maxScroll = Math.max(0, scrollHeight - innerHeight);
  return Math.max(0, Math.min(scrollTop, maxScroll));
};

const findScrollableCandidates = (
  mouseEvent: MouseEvent,
  scrollables: Map<string, ScrollableEntry>,
) => {
  const candidates: Array<ScrollableEntry & { area: number }> = [];

  for (const entry of scrollables.values()) {
    if (!entry.ref.current) {
      continue;
    }

    const boundingBox = getBoundingBox(entry.ref.current);
    if (!boundingBox) continue;

    const { x, y, width, height } = boundingBox;

    const isInside =
      mouseEvent.col >= x &&
      mouseEvent.col < x + width + 1 && // Intentionally add one to width to include scrollbar.
      mouseEvent.row >= y &&
      mouseEvent.row < y + height;

    if (isInside) {
      candidates.push({ ...entry, area: width * height });
    }
  }

  // Sort by smallest area first
  candidates.sort((a, b) => a.area - b.area);
  return candidates;
};

function flushPendingScrolls(
  flushScheduledRef: React.RefObject<boolean>,
  pendingFlushRef: React.RefObject<Set<string>>,
  scrollablesRef: React.RefObject<Map<string, ScrollableEntry>>,
  trueScrollRef: React.RefObject<Map<string, { floatValue: number; expectedScrollTop: number }>>,
): void {
  if (flushScheduledRef.current) return;
  flushScheduledRef.current = true;
  setTimeout(() => {
    flushScheduledRef.current = false;
    const ids = Array.from(pendingFlushRef.current);
    pendingFlushRef.current.clear();
    for (const id of ids) {
      const entry = scrollablesRef.current.get(id);
      const trueScroll = trueScrollRef.current.get(id);
      if (entry && trueScroll) {
        const { scrollTop, scrollHeight, innerHeight } = entry.getScrollState();
        if (trueScroll.expectedScrollTop !== scrollTop) {
          trueScrollRef.current.set(id, { floatValue: scrollTop, expectedScrollTop: scrollTop });
          continue;
        }
        const clampedFloat = getClampedScrollTop(trueScroll.floatValue, scrollHeight, innerHeight);
        const roundedTarget = Math.round(clampedFloat);
        const deltaToApply = roundedTarget - scrollTop;
        if (deltaToApply !== 0) {
          entry.scrollBy(deltaToApply);
          trueScroll.expectedScrollTop = roundedTarget;
        }
        trueScroll.floatValue = clampedFloat;
      } else {
        trueScrollRef.current.delete(id);
      }
    }
  }, 0);
}

function tryScrollbarDrag(
  entry: ScrollableEntry,
  mouseEvent: MouseEvent,
  dragStateRef: React.RefObject<{ active: boolean; id: string | null; offset: number }>,
): boolean {
  if (!entry.ref.current || !entry.hasFocus()) return false;
  const boundingBox = getBoundingBox(entry.ref.current);
  if (!boundingBox) return false;

  const { x, y, width, height } = boundingBox;
  if (mouseEvent.col !== x + width || mouseEvent.row < y || mouseEvent.row >= y + height) {
    return false;
  }

  const { scrollTop, scrollHeight, innerHeight } = entry.getScrollState();
  if (scrollHeight <= innerHeight) return false;

  const thumbHeight = Math.max(1, Math.floor((innerHeight / scrollHeight) * innerHeight));
  const maxScrollTop = scrollHeight - innerHeight;
  const maxThumbY = innerHeight - thumbHeight;
  if (maxThumbY <= 0) return false;

  const currentThumbY = Math.round((scrollTop / maxScrollTop) * maxThumbY);
  const absoluteThumbTop = y + currentThumbY;
  const absoluteThumbBottom = absoluteThumbTop + thumbHeight;
  const hitTop = mouseEvent.row === y ? absoluteThumbTop : absoluteThumbTop - 1;
  const hitBottom =
    mouseEvent.row === y + height - 1 ? absoluteThumbBottom : absoluteThumbBottom + 1;
  const isThumbClick = mouseEvent.row >= hitTop && mouseEvent.row < hitBottom;

  const relativeMouseY = mouseEvent.row - y;
  let offset = 0;
  if (isThumbClick) {
    offset = relativeMouseY - currentThumbY;
  } else {
    const targetThumbY = Math.max(
      0,
      Math.min(maxThumbY, relativeMouseY - Math.floor(thumbHeight / 2)),
    );
    const newScrollTop = Math.round((targetThumbY / maxThumbY) * maxScrollTop);
    if (entry.scrollTo) {
      entry.scrollTo(newScrollTop);
    } else {
      entry.scrollBy(newScrollTop - scrollTop);
    }
    offset = relativeMouseY - targetThumbY;
  }

  dragStateRef.current = { active: true, id: entry.id, offset };
  return true;
}

function handleScrollbarLeftPress(
  mouseEvent: MouseEvent,
  scrollablesRef: React.RefObject<Map<string, ScrollableEntry>>,
  dragStateRef: React.RefObject<{ active: boolean; id: string | null; offset: number }>,
): boolean {
  for (const entry of scrollablesRef.current.values()) {
    if (tryScrollbarDrag(entry, mouseEvent, dragStateRef)) {
      return true;
    }
  }

  const candidates = findScrollableCandidates(mouseEvent, scrollablesRef.current);
  if (candidates.length > 0) {
    const firstCandidate = candidates.at(0);
    firstCandidate?.flashScrollbar();
  }
  return false;
}

export const ScrollProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [scrollables, setScrollables] = useState(new Map<string, ScrollableEntry>());

  const register = useCallback((entry: ScrollableEntry) => {
    setScrollables((prev) => new Map(prev).set(entry.id, entry));
  }, []);

  const unregister = useCallback((id: string) => {
    setScrollables((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    trueScrollRef.current.delete(id);
    pendingFlushRef.current.delete(id);
  }, []);

  const scrollablesRef = useRef(scrollables);
  useEffect(() => {
    scrollablesRef.current = scrollables;
  }, [scrollables]);

  const trueScrollRef = useRef(
    new Map<string, { floatValue: number; expectedScrollTop: number }>(),
  );
  const pendingFlushRef = useRef(new Set<string>());
  const flushScheduledRef = useRef(false);

  const dragStateRef = useRef<{
    active: boolean;
    id: string | null;
    offset: number;
  }>({
    active: false,
    id: null,
    offset: 0,
  });

  const scheduleFlush = useCallback(
    () => flushPendingScrolls(flushScheduledRef, pendingFlushRef, scrollablesRef, trueScrollRef),
    [],
  );

  const scrollMomentumRef = useRef({
    count: 0,
    lastTime: 0,
    lastDirection: null as 'up' | 'down' | null,
  });

  const handleScroll = (direction: 'up' | 'down', mouseEvent: MouseEvent) => {
    let multiplier = 1;
    const now = Date.now();

    if (!terminalCapabilityManager.isGhosttyTerminal()) {
      const timeSinceLastScroll = now - scrollMomentumRef.current.lastTime;
      const isSameDirection = scrollMomentumRef.current.lastDirection === direction;

      // 50ms threshold to consider scrolls consecutive
      if (timeSinceLastScroll < 50 && isSameDirection) {
        scrollMomentumRef.current.count += 1;
        // Accelerate up to 3x, starting after 5 consecutive scrolls.
        // Each consecutive scroll increases the multiplier by 0.1.
        multiplier = Math.min(3, 1 + Math.max(0, scrollMomentumRef.current.count - 5) * 0.1);
      } else {
        scrollMomentumRef.current.count = 0;
      }
    }
    scrollMomentumRef.current.lastTime = now;
    scrollMomentumRef.current.lastDirection = direction;

    const delta = (direction === 'up' ? -1 : 1) * multiplier;
    const candidates = findScrollableCandidates(mouseEvent, scrollablesRef.current);

    for (const candidate of candidates) {
      const { scrollTop, scrollHeight, innerHeight } = candidate.getScrollState();

      let trueScroll = trueScrollRef.current.get(candidate.id);
      if (!trueScroll || trueScroll.expectedScrollTop !== scrollTop) {
        trueScroll = { floatValue: scrollTop, expectedScrollTop: scrollTop };
      }

      const maxScroll = Math.max(0, scrollHeight - innerHeight);
      const canScrollUp = trueScroll.floatValue > SCROLL_STATIC_FRICTION;
      const canScrollDown = trueScroll.floatValue < maxScroll - SCROLL_STATIC_FRICTION;

      if ((direction === 'up' && canScrollUp) || (direction === 'down' && canScrollDown)) {
        const clampedFloat = getClampedScrollTop(
          trueScroll.floatValue + delta,
          scrollHeight,
          innerHeight,
        );

        trueScrollRef.current.set(candidate.id, {
          floatValue: clampedFloat,
          expectedScrollTop: trueScroll.expectedScrollTop,
        });

        pendingFlushRef.current.add(candidate.id);
        scheduleFlush();
        return true;
      }
    }
    return false;
  };

  const handleLeftPress = useCallback((mouseEvent: MouseEvent) => {
    return handleScrollbarLeftPress(mouseEvent, scrollablesRef, dragStateRef);
  }, []);

  const handleMove = (mouseEvent: MouseEvent) => {
    const state = dragStateRef.current;
    if (!state.active || !state.id) return false;

    const entry = scrollablesRef.current.get(state.id);
    if (!entry || !entry.ref.current) {
      state.active = false;
      return false;
    }

    const boundingBox = getBoundingBox(entry.ref.current);
    if (!boundingBox) return false;

    const { y } = boundingBox;
    const { scrollTop, scrollHeight, innerHeight } = entry.getScrollState();

    const thumbHeight = Math.max(1, Math.floor((innerHeight / scrollHeight) * innerHeight));
    const maxScrollTop = scrollHeight - innerHeight;
    const maxThumbY = innerHeight - thumbHeight;

    if (maxThumbY <= 0) return false;

    const relativeMouseY = mouseEvent.row - y;
    // Calculate the target thumb position based on the mouse position and the offset.
    // We clamp it to the valid range [0, maxThumbY].
    const targetThumbY = Math.max(0, Math.min(maxThumbY, relativeMouseY - state.offset));

    const targetScrollTop = Math.round((targetThumbY / maxThumbY) * maxScrollTop);

    if (entry.scrollTo) {
      entry.scrollTo(targetScrollTop, 0);
    } else {
      entry.scrollBy(targetScrollTop - scrollTop);
    }
    return true;
  };

  const handleLeftRelease = () => {
    if (dragStateRef.current.active) {
      dragStateRef.current = {
        active: false,
        id: null,
        offset: 0,
      };
      return true;
    }
    return false;
  };

  useMouse(
    (event: MouseEvent) => {
      if (event.name === 'scroll-up') {
        return handleScroll('up', event);
      } else if (event.name === 'scroll-down') {
        return handleScroll('down', event);
      } else if (event.name === 'left-press') {
        return handleLeftPress(event);
      } else if (event.name === 'move') {
        return handleMove(event);
      } else if (event.name === 'left-release') {
        return handleLeftRelease();
      }
      return false;
    },
    { isActive: true },
  );

  const contextValue = useMemo(() => ({ register, unregister }), [register, unregister]);

  return <ScrollContext.Provider value={contextValue}>{children}</ScrollContext.Provider>;
};

let nextId = 0;

export const useScrollable = (entry: Omit<ScrollableEntry, 'id'>, isActive: boolean) => {
  const context = useContext(ScrollContext);
  if (!context) {
    throw new Error('useScrollable must be used within a ScrollProvider');
  }

  const [id] = useState(() => `scrollable-${nextId++}`);

  useEffect(() => {
    if (isActive) {
      context.register({ ...entry, id });
      return () => {
        context.unregister(id);
      };
    }
  }, [context, entry, id, isActive]);
};
