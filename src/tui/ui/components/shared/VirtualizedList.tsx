import React, {
  forwardRef,
  memo,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { theme } from '../../semantic-colors.js';
import { useBatchedScroll } from '../../hooks/useBatchedScroll.js';

import { type DOMElement, Box, ResizeObserver, StaticRender } from 'ink';

export const SCROLL_TO_ITEM_END = Number.MAX_SAFE_INTEGER;

interface ScrollAnchor {
  index: number;
  offset: number;
}

function computeInitialScrollAnchor(
  initialScrollIndex: number | undefined,
  initialScrollOffsetInIndex: number | undefined,
  dataLength: number,
  targetScrollIndex: number | undefined,
): ScrollAnchor {
  const scrollToEnd =
    initialScrollIndex === SCROLL_TO_ITEM_END ||
    (typeof initialScrollIndex === 'number' &&
      initialScrollIndex >= dataLength - 1 &&
      initialScrollOffsetInIndex === SCROLL_TO_ITEM_END);

  if (scrollToEnd) {
    return { index: dataLength > 0 ? dataLength - 1 : 0, offset: SCROLL_TO_ITEM_END };
  }

  if (typeof initialScrollIndex === 'number') {
    return {
      index: Math.max(0, Math.min(dataLength - 1, initialScrollIndex)),
      offset: initialScrollOffsetInIndex ?? 0,
    };
  }

  if (typeof targetScrollIndex === 'number') {
    return { index: targetScrollIndex, offset: 0 };
  }

  return { index: 0, offset: 0 };
}

interface ScrollMethodImplsParams {
  offsets: number[];
  scrollAnchor: ScrollAnchor;
  totalHeight: number;
  scrollableContainerHeight: number;
  getAnchorForScrollTop: (scrollTop: number, scrollOffsets: number[]) => ScrollAnchor;
  getScrollTop: () => number;
  setPendingScrollTop: (v: number) => void;
  setScrollAnchor: (anchor: ScrollAnchor) => void;
  setIsStickingToBottom: (v: boolean) => void;
  data: unknown[];
}

function createScrollMethodImpls({
  offsets,
  scrollAnchor,
  totalHeight,
  scrollableContainerHeight,
  getAnchorForScrollTop,
  getScrollTop,
  setPendingScrollTop,
  setScrollAnchor,
  setIsStickingToBottom,
  data,
}: ScrollMethodImplsParams) {
  return {
    scrollBy: (delta: number) => {
      if (delta < 0) {
        setIsStickingToBottom(false);
      }
      const currentScrollTop = getScrollTop();
      const maxScroll = Math.max(0, totalHeight - scrollableContainerHeight);
      const actualCurrent = Math.min(currentScrollTop, maxScroll);
      let newScrollTop = Math.max(0, actualCurrent + delta);
      if (newScrollTop >= maxScroll) {
        setIsStickingToBottom(true);
        newScrollTop = Number.MAX_SAFE_INTEGER;
      }
      setPendingScrollTop(newScrollTop);
      setScrollAnchor(getAnchorForScrollTop(Math.min(newScrollTop, maxScroll), offsets));
    },
    scrollTo: (offset: number) => {
      const maxScroll = Math.max(0, totalHeight - scrollableContainerHeight);
      if (offset >= maxScroll || offset === SCROLL_TO_ITEM_END) {
        setIsStickingToBottom(true);
        setPendingScrollTop(Number.MAX_SAFE_INTEGER);
        if (data.length > 0) {
          setScrollAnchor({ index: data.length - 1, offset: SCROLL_TO_ITEM_END });
        }
      } else {
        setIsStickingToBottom(false);
        const newScrollTop = Math.max(0, offset);
        setPendingScrollTop(newScrollTop);
        setScrollAnchor(getAnchorForScrollTop(newScrollTop, offsets));
      }
    },
    scrollToEnd: () => {
      setIsStickingToBottom(true);
      setPendingScrollTop(Number.MAX_SAFE_INTEGER);
      if (data.length > 0) {
        setScrollAnchor({ index: data.length - 1, offset: SCROLL_TO_ITEM_END });
      }
    },
    scrollToIndex: ({
      index,
      viewOffset = 0,
      viewPosition = 0,
    }: {
      index: number;
      viewOffset?: number;
      viewPosition?: number;
    }) => {
      setIsStickingToBottom(false);
      const offset = offsets.at(index);
      if (offset !== undefined) {
        const maxScroll = Math.max(0, totalHeight - scrollableContainerHeight);
        const newScrollTop = Math.max(
          0,
          Math.min(maxScroll, offset - viewPosition * scrollableContainerHeight + viewOffset),
        );
        setPendingScrollTop(newScrollTop);
        setScrollAnchor(getAnchorForScrollTop(newScrollTop, offsets));
      }
    },
    scrollToItem: (item: unknown, viewOffset?: number, viewPosition?: number) => {
      setIsStickingToBottom(false);
      const index = data.indexOf(item);
      if (index !== -1) {
        const offset = offsets.at(index);
        if (offset !== undefined) {
          const maxScroll = Math.max(0, totalHeight - scrollableContainerHeight);
          const newScrollTop = Math.max(
            0,
            Math.min(
              maxScroll,
              offset - (viewPosition ?? 0) * scrollableContainerHeight + (viewOffset ?? 0),
            ),
          );
          setPendingScrollTop(newScrollTop);
          setScrollAnchor(getAnchorForScrollTop(newScrollTop, offsets));
        }
      }
    },
    getScrollIndex: () => scrollAnchor.index,
    getScrollState: () => {
      const maxScroll = Math.max(0, totalHeight - scrollableContainerHeight);
      return {
        scrollTop: Math.min(getScrollTop(), maxScroll),
        scrollHeight: totalHeight,
        innerHeight: scrollableContainerHeight,
      };
    },
  };
}

interface ScrollManagementParams {
  dataLength: number;
  totalHeight: number;
  actualScrollTop: number;
  scrollableContainerHeight: number;
  isStickingToBottom: boolean;
  setIsStickingToBottom: (v: boolean) => void;
  scrollAnchor: ScrollAnchor;
  setScrollAnchor: (anchor: ScrollAnchor) => void;
  getAnchorForScrollTop: (scrollTop: number, scrollOffsets: number[]) => ScrollAnchor;
  offsets: number[];
  targetScrollIndex: number | undefined;
  prevDataLength: React.MutableRefObject<number>;
  prevTotalHeight: React.MutableRefObject<number>;
  prevScrollTop: React.MutableRefObject<number>;
  prevContainerHeight: React.MutableRefObject<number>;
}

type ListWidth = number | string | undefined;

interface RenderedItemsParams<T> {
  isReady: boolean;
  renderRangeStart: number;
  renderRangeEnd: number;
  data: T[];
  startIndex: number;
  endIndex: number;
  renderStatic: boolean | undefined;
  isStaticItem: ((item: T, index: number) => boolean) | undefined;
  renderItem: (info: { item: T; index: number }) => React.ReactElement;
  keyExtractor: (item: T, index: number) => string;
  width: ListWidth;
  containerWidth: number;
  onSetRef: (index: number, el: DOMElement | null) => void;
}

function buildRenderedItems<T>({
  isReady,
  renderRangeStart,
  renderRangeEnd,
  data,
  startIndex,
  endIndex,
  renderStatic,
  isStaticItem,
  renderItem,
  keyExtractor,
  width,
  containerWidth,
  onSetRef,
}: RenderedItemsParams<T>): React.ReactElement[] {
  if (!isReady) {
    return [];
  }

  const items: React.ReactElement[] = [];
  for (let i = renderRangeStart; i <= renderRangeEnd; i++) {
    const item = data.at(i);
    if (item) {
      const isOutsideViewport = i < startIndex || i > endIndex;
      const shouldBeStatic =
        (renderStatic === true && isOutsideViewport) || isStaticItem?.(item, i) === true;

      const content = renderItem({ item, index: i });
      const key = keyExtractor(item, i);

      items.push(
        <VirtualizedListItem
          key={key}
          itemKey={key}
          content={content}
          shouldBeStatic={shouldBeStatic}
          width={width}
          containerWidth={containerWidth}
          index={i}
          onSetRef={onSetRef}
        />,
      );
    }
  }
  return items;
}

function observeNewNodes(
  observeStart: number,
  observeEnd: number,
  itemRefs: React.MutableRefObject<(DOMElement | null)[]>,
  data: unknown[],
  keyExtractor: (item: unknown, index: number) => string,
  isStatic: boolean,
  fixedItemHeight: boolean,
  observedNodes: React.MutableRefObject<Set<DOMElement>>,
  itemsObserver: ResizeObserver,
  nodeToKeyRef: React.MutableRefObject<WeakMap<DOMElement, string>>,
): Set<DOMElement> {
  const currentNodes = new Set<DOMElement>();
  for (let i = observeStart; i <= observeEnd; i++) {
    const node = itemRefs.current.at(i);
    const item = data.at(i);
    if (node && item) {
      currentNodes.add(node);
      const key = keyExtractor(item, i);
      nodeToKeyRef.current.set(node, key);
      if (!isStatic && !fixedItemHeight && !observedNodes.current.has(node)) {
        itemsObserver.observe(node);
      }
    }
  }
  return currentNodes;
}

function unobserveStaleNodes(
  observedNodes: React.MutableRefObject<Set<DOMElement>>,
  currentNodes: Set<DOMElement>,
  isStatic: boolean,
  fixedItemHeight: boolean,
  itemsObserver: ResizeObserver,
  nodeToKeyRef: React.MutableRefObject<WeakMap<DOMElement, string>>,
): void {
  for (const node of observedNodes.current) {
    if (!currentNodes.has(node)) {
      if (!isStatic && !fixedItemHeight) {
        itemsObserver.unobserve(node);
      }
      nodeToKeyRef.current.delete(node);
    }
  }
}

function observeVisibleNodes(
  startIndex: number,
  endIndex: number,
  renderStatic: boolean | undefined,
  overflowToBackbuffer: boolean | undefined,
  dataLength: number,
  itemRefs: React.MutableRefObject<(DOMElement | null)[]>,
  data: unknown[],
  keyExtractor: (item: unknown, index: number) => string,
  isStatic: boolean,
  fixedItemHeight: boolean,
  observedNodes: React.MutableRefObject<Set<DOMElement>>,
  itemsObserver: ResizeObserver,
  nodeToKeyRef: React.MutableRefObject<WeakMap<DOMElement, string>>,
): void {
  const observeStart = renderStatic || overflowToBackbuffer ? 0 : startIndex;
  const observeEnd = renderStatic ? dataLength - 1 : endIndex;

  const currentNodes = observeNewNodes(
    observeStart,
    observeEnd,
    itemRefs,
    data,
    keyExtractor,
    isStatic,
    fixedItemHeight,
    observedNodes,
    itemsObserver,
    nodeToKeyRef,
  );

  unobserveStaleNodes(
    observedNodes,
    currentNodes,
    isStatic,
    fixedItemHeight,
    itemsObserver,
    nodeToKeyRef,
  );

  observedNodes.current = currentNodes;
}

function applyInitialScroll(
  initialScrollIndex: number | undefined,
  initialScrollOffsetInIndex: number | undefined,
  offsets: number[],
  totalHeight: number,
  scrollableContainerHeight: number,
  dataLength: number,
  _heights: Record<string, number>,
  targetScrollIndex: number | undefined,
  isInitialScrollSet: React.MutableRefObject<boolean>,
  setScrollAnchor: (anchor: ScrollAnchor) => void,
  setIsStickingToBottom: (v: boolean) => void,
  getAnchorForScrollTop: (scrollTop: number, scrollOffsets: number[]) => ScrollAnchor,
): void {
  if (
    isInitialScrollSet.current ||
    offsets.length <= 1 ||
    totalHeight <= 0 ||
    scrollableContainerHeight <= 0
  ) {
    return;
  }

  if (targetScrollIndex !== undefined) {
    isInitialScrollSet.current = true;
    return;
  }

  if (typeof initialScrollIndex === 'number') {
    const scrollToEnd =
      initialScrollIndex === SCROLL_TO_ITEM_END ||
      (initialScrollIndex >= dataLength - 1 && initialScrollOffsetInIndex === SCROLL_TO_ITEM_END);

    if (scrollToEnd) {
      setScrollAnchor({ index: dataLength - 1, offset: SCROLL_TO_ITEM_END });
      setIsStickingToBottom(true);
      isInitialScrollSet.current = true;
      return;
    }

    const index = Math.max(0, Math.min(dataLength - 1, initialScrollIndex));
    const offset = initialScrollOffsetInIndex ?? 0;
    const newScrollTop = (offsets.at(index) ?? 0) + offset;
    const clampedScrollTop = Math.max(
      0,
      Math.min(totalHeight - scrollableContainerHeight, newScrollTop),
    );

    setScrollAnchor(getAnchorForScrollTop(clampedScrollTop, offsets));
    isInitialScrollSet.current = true;
  }
}

function computeVisibleRange(
  offsets: number[],
  actualScrollTop: number,
  scrollableContainerHeight: number,
  dataLength: number,
  renderStatic: boolean | undefined,
  overflowToBackbuffer: boolean | undefined,
): {
  startIndex: number;
  endIndex: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  renderRangeStart: number;
  renderRangeEnd: number;
} {
  const startIndex = Math.max(0, findLastIndex(offsets, (offset) => offset <= actualScrollTop) - 1);
  const viewHeightForEndIndex = scrollableContainerHeight > 0 ? scrollableContainerHeight : 50;
  const endIndexOffset = offsets.findIndex(
    (offset) => offset > actualScrollTop + viewHeightForEndIndex,
  );
  const endIndex =
    endIndexOffset === -1 ? dataLength - 1 : Math.min(dataLength - 1, endIndexOffset);

  const topSpacerHeight =
    renderStatic === true || overflowToBackbuffer === true ? 0 : (offsets.at(startIndex) ?? 0);
  const bottomSpacerHeight = 0;

  const renderRangeStart = renderStatic || overflowToBackbuffer ? 0 : startIndex;
  const renderRangeEnd = renderStatic ? dataLength - 1 : endIndex;

  return {
    startIndex,
    endIndex,
    topSpacerHeight,
    bottomSpacerHeight,
    renderRangeStart,
    renderRangeEnd,
  };
}

function checkScrollToBottom(params: ScrollManagementParams): void {
  const contentPreviouslyFit = params.prevTotalHeight.current <= params.prevContainerHeight.current;
  const wasScrolledToBottomPixels =
    params.prevScrollTop.current >=
    params.prevTotalHeight.current - params.prevContainerHeight.current - 1;
  const wasAtBottom = contentPreviouslyFit || wasScrolledToBottomPixels;

  if (wasAtBottom && params.actualScrollTop >= params.prevScrollTop.current) {
    if (!params.isStickingToBottom) {
      params.setIsStickingToBottom(true);
    }
  }
}

function handleBottomTargetScroll(params: ScrollManagementParams): void {
  const newIndex = params.dataLength > 0 ? params.dataLength - 1 : 0;
  if (params.scrollAnchor.index !== newIndex || params.scrollAnchor.offset !== SCROLL_TO_ITEM_END) {
    params.setScrollAnchor({ index: newIndex, offset: SCROLL_TO_ITEM_END });
  }
  if (!params.isStickingToBottom) {
    params.setIsStickingToBottom(true);
  }
}

function handleOutOfBoundsScroll(params: ScrollManagementParams): void {
  if (params.dataLength > 0) {
    const newScrollTop = Math.max(0, params.totalHeight - params.scrollableContainerHeight);
    const newAnchor = params.getAnchorForScrollTop(newScrollTop, params.offsets);
    if (
      params.scrollAnchor.index !== newAnchor.index ||
      params.scrollAnchor.offset !== newAnchor.offset
    ) {
      params.setScrollAnchor(newAnchor);
    }
  } else {
    if (params.scrollAnchor.index !== 0 || params.scrollAnchor.offset !== 0) {
      params.setScrollAnchor({ index: 0, offset: 0 });
    }
  }
}

function handleAutoScroll(params: ScrollManagementParams): void {
  if (params.targetScrollIndex !== undefined) return;

  const listGrew = params.dataLength > params.prevDataLength.current;
  const containerChanged = params.prevContainerHeight.current !== params.scrollableContainerHeight;
  const contentFit = params.prevTotalHeight.current <= params.prevContainerHeight.current;
  const atBottomPixels =
    params.prevScrollTop.current >=
    params.prevTotalHeight.current - params.prevContainerHeight.current - 1;
  const wasAtBottom = contentFit || atBottomPixels;

  const isTargetingBottom =
    (listGrew && (params.isStickingToBottom || wasAtBottom)) ||
    (params.isStickingToBottom && containerChanged);

  if (isTargetingBottom) {
    handleBottomTargetScroll(params);
    return;
  }

  const isOutOfBounds =
    params.scrollAnchor.index >= params.dataLength ||
    params.actualScrollTop > params.totalHeight - params.scrollableContainerHeight;

  if (isOutOfBounds) {
    handleOutOfBoundsScroll(params);
  }
}

function manageScrollBehavior(params: ScrollManagementParams): void {
  checkScrollToBottom(params);
  handleAutoScroll(params);

  params.prevDataLength.current = params.dataLength;
  params.prevTotalHeight.current = params.totalHeight;
  params.prevScrollTop.current = params.actualScrollTop;
  params.prevContainerHeight.current = params.scrollableContainerHeight;
}

export type VirtualizedListProps<T> = {
  data: T[];
  renderItem: (info: { item: T; index: number }) => React.ReactElement;
  estimatedItemHeight: (index: number) => number;
  keyExtractor: (item: T, index: number) => string;
  initialScrollIndex?: number;
  initialScrollOffsetInIndex?: number;
  targetScrollIndex?: number;
  backgroundColor?: string;
  scrollbarThumbColor?: string;
  renderStatic?: boolean;
  isStatic?: boolean;
  isStaticItem?: (item: T, index: number) => boolean;
  width?: number | string;
  overflowToBackbuffer?: boolean;
  scrollbar?: boolean;
  stableScrollback?: boolean;
  copyModeEnabled?: boolean;
  fixedItemHeight?: boolean;
  containerHeight?: number;
};

export type VirtualizedListRef<T> = {
  scrollBy: (delta: number) => void;
  scrollTo: (offset: number) => void;
  scrollToEnd: () => void;
  scrollToIndex: (params: { index: number; viewOffset?: number; viewPosition?: number }) => void;
  scrollToItem: (params: { item: T; viewOffset?: number; viewPosition?: number }) => void;
  getScrollIndex: () => number;
  getScrollState: () => {
    scrollTop: number;
    scrollHeight: number;
    innerHeight: number;
  };
};

function findLastIndex<T>(
  array: T[],
  predicate: (value: T, index: number, obj: T[]) => unknown,
): number {
  for (let i = array.length - 1; i >= 0; i--) {
    const val = array.at(i);
    if (val !== undefined && predicate(val, i, array)) {
      return i;
    }
  }
  return -1;
}

const VirtualizedListItem = memo(
  ({
    content,
    shouldBeStatic,
    width,
    containerWidth,
    itemKey,
    index,
    onSetRef,
  }: {
    content: React.ReactElement;
    shouldBeStatic: boolean;
    width: ListWidth;
    containerWidth: number;
    itemKey: string;
    index: number;
    onSetRef: (idx: number, el: DOMElement | null) => void;
  }) => {
    const itemRef = useCallback(
      (el: DOMElement | null) => {
        onSetRef(index, el);
      },
      [index, onSetRef],
    );

    return (
      <Box width="100%" flexDirection="column" flexShrink={0} ref={itemRef}>
        {shouldBeStatic ? (
          <StaticRender
            width={typeof width === 'number' ? width : containerWidth}
            key={itemKey + '-static-' + (typeof width === 'number' ? width : containerWidth)}
          >
            {content}
          </StaticRender>
        ) : (
          content
        )}
      </Box>
    );
  },
);

VirtualizedListItem.displayName = 'VirtualizedListItem';

function findAnchorForScrollTop(scrollTop: number, scrollOffsets: number[]): ScrollAnchor {
  const index = findLastIndex(scrollOffsets, (offset) => offset <= scrollTop);
  if (index === -1) {
    return { index: 0, offset: 0 };
  }
  const currentOffset = scrollOffsets.at(index) ?? 0;
  return { index, offset: scrollTop - currentOffset };
}

function computeActualScrollTop<T>(
  scrollAnchor: ScrollAnchor,
  offsets: number[],
  data: T[],
  keyExtractor: (item: T, index: number) => string,
  heights: Record<string, number>,
  scrollableContainerHeight: number,
): number {
  const offset = offsets.at(scrollAnchor.index);
  if (typeof offset !== 'number') {
    return 0;
  }

  if (scrollAnchor.offset === SCROLL_TO_ITEM_END) {
    const item = data.at(scrollAnchor.index);
    const key = item ? keyExtractor(item, scrollAnchor.index) : '';
    const heightsMap = new Map(Object.entries(heights));
    const itemHeight = heightsMap.get(key) ?? 0;
    return offset + itemHeight - scrollableContainerHeight;
  }

  return offset + scrollAnchor.offset;
}

function computeOffsetsAndTotalHeight<T>(
  data: T[],
  heights: Record<string, number>,
  estimatedItemHeight: (index: number) => number,
  keyExtractor: (item: T, index: number) => string,
): { totalHeight: number; offsets: number[] } {
  const innerOffsets: number[] = [0];
  let innerTotalHeight = 0;
  const heightsMap = new Map(Object.entries(heights));
  for (let i = 0; i < data.length; i++) {
    const item = data.at(i);
    if (!item) continue;
    const key = keyExtractor(item, i);
    const height = heightsMap.get(key) ?? estimatedItemHeight(i);
    innerTotalHeight += height;
    innerOffsets.push(innerTotalHeight);
  }
  return { totalHeight: innerTotalHeight, offsets: innerOffsets };
}

function createContainerRefCallback(
  containerRef: React.MutableRefObject<DOMElement | null>,
  containerObserverRef: React.MutableRefObject<ResizeObserver | null>,
  setContainerHeight: React.Dispatch<React.SetStateAction<number>>,
  setContainerWidth: React.Dispatch<React.SetStateAction<number>>,
) {
  return (node: DOMElement | null) => {
    containerObserverRef.current?.disconnect();
    containerRef.current = node;
    if (node) {
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) {
          const newHeight = Math.round(entry.contentRect.height);
          const newWidth = Math.round(entry.contentRect.width);
          setContainerHeight((prev) => (prev !== newHeight ? newHeight : prev));
          setContainerWidth((prev) => (prev !== newWidth ? newWidth : prev));
        }
      });
      observer.observe(node);
      containerObserverRef.current = observer;
    }
  };
}

function createItemsObserver(
  nodeToKeyRef: React.MutableRefObject<WeakMap<DOMElement, string>>,
  setHeights: React.Dispatch<React.SetStateAction<Record<string, number>>>,
): ResizeObserver {
  return new ResizeObserver((entries) => {
    setHeights((prev) => {
      let next: Record<string, number> | null = null;
      const prevMap = new Map(Object.entries(prev));
      for (const entry of entries) {
        const key = nodeToKeyRef.current.get(entry.target);
        if (key !== undefined) {
          const height = Math.round(entry.contentRect.height);
          if (prevMap.get(key) !== height) {
            if (!next) {
              next = { ...prev };
            }
            Object.assign(next, { [key]: height });
          }
        }
      }
      return next ?? prev;
    });
  });
}

function useVirtualizedScrollManagement<T>(
  data: T[],
  totalHeight: number,
  actualScrollTop: number,
  scrollableContainerHeight: number,
  isStickingToBottom: boolean,
  setIsStickingToBottom: React.Dispatch<React.SetStateAction<boolean>>,
  scrollAnchor: ScrollAnchor,
  setScrollAnchor: React.Dispatch<React.SetStateAction<ScrollAnchor>>,
  getAnchorForScrollTop: (scrollTop: number, scrollOffsets: number[]) => ScrollAnchor,
  offsets: number[],
  targetScrollIndex?: number,
) {
  const prevDataRef = useRef({
    dataLength: data.length,
    totalHeight,
    scrollTop: actualScrollTop,
    containerHeight: scrollableContainerHeight,
  });

  useLayoutEffect(() => {
    manageScrollBehavior({
      dataLength: data.length,
      totalHeight,
      actualScrollTop,
      scrollableContainerHeight,
      isStickingToBottom,
      setIsStickingToBottom,
      scrollAnchor,
      setScrollAnchor,
      getAnchorForScrollTop,
      offsets,
      targetScrollIndex,
      prevDataLength: {
        get current() {
          return prevDataRef.current.dataLength;
        },
        set current(v: number) {
          prevDataRef.current.dataLength = v;
        },
      },
      prevTotalHeight: {
        get current() {
          return prevDataRef.current.totalHeight;
        },
        set current(v: number) {
          prevDataRef.current.totalHeight = v;
        },
      },
      prevScrollTop: {
        get current() {
          return prevDataRef.current.scrollTop;
        },
        set current(v: number) {
          prevDataRef.current.scrollTop = v;
        },
      },
      prevContainerHeight: {
        get current() {
          return prevDataRef.current.containerHeight;
        },
        set current(v: number) {
          prevDataRef.current.containerHeight = v;
        },
      },
    });
  }, [
    data.length,
    totalHeight,
    actualScrollTop,
    scrollableContainerHeight,
    scrollAnchor,
    getAnchorForScrollTop,
    offsets,
    isStickingToBottom,
    targetScrollIndex,
    setIsStickingToBottom,
    setScrollAnchor,
  ]);
}

function updateTargetScrollIndexState(
  targetScrollIndex: number | undefined,
  offsetsLength: number,
  prevTargetScrollIndex: number | undefined,
  setPrevTargetScrollIndex: React.Dispatch<React.SetStateAction<number | undefined>>,
  prevOffsetsLengthRef: React.MutableRefObject<number>,
  setIsStickingToBottom: React.Dispatch<React.SetStateAction<boolean>>,
  setScrollAnchor: React.Dispatch<React.SetStateAction<ScrollAnchor>>,
) {
  if (
    (targetScrollIndex !== undefined &&
      targetScrollIndex !== prevTargetScrollIndex &&
      offsetsLength > 1) ||
    (targetScrollIndex !== undefined && prevOffsetsLengthRef.current <= 1 && offsetsLength > 1)
  ) {
    if (targetScrollIndex !== prevTargetScrollIndex) {
      setPrevTargetScrollIndex(targetScrollIndex);
    }
    prevOffsetsLengthRef.current = offsetsLength;
    setIsStickingToBottom(false);
    setScrollAnchor({ index: targetScrollIndex, offset: 0 });
  } else {
    prevOffsetsLengthRef.current = offsetsLength;
  }
}

function useVirtualizedLayout<T>(props: VirtualizedListProps<T>) {
  const {
    data,
    estimatedItemHeight,
    keyExtractor,
    initialScrollIndex,
    initialScrollOffsetInIndex,
    renderStatic,
    isStatic = false,
    overflowToBackbuffer,
    fixedItemHeight = false,
  } = props;

  const dataRef = useRef(data);
  useLayoutEffect(() => {
    dataRef.current = data;
  }, [data]);

  const [scrollAnchor, setScrollAnchor] = useState(() =>
    computeInitialScrollAnchor(
      initialScrollIndex,
      initialScrollOffsetInIndex,
      data.length,
      props.targetScrollIndex,
    ),
  );

  const [isStickingToBottom, setIsStickingToBottom] = useState(() => {
    const scrollToEnd =
      initialScrollIndex === SCROLL_TO_ITEM_END ||
      (typeof initialScrollIndex === 'number' &&
        initialScrollIndex >= data.length - 1 &&
        initialScrollOffsetInIndex === SCROLL_TO_ITEM_END);
    return scrollToEnd;
  });

  const containerRef = useRef<DOMElement | null>(null);
  const [containerHeight, setContainerHeight] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const itemRefs = useRef<Array<DOMElement | null>>([]);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const isInitialScrollSet = useRef(false);

  const containerObserverRef = useRef<ResizeObserver | null>(null);
  const nodeToKeyRef = useRef(new WeakMap<DOMElement, string>());

  const onSetRef = useCallback((idx: number, el: DOMElement | null) => {
    while (itemRefs.current.length <= idx) {
      itemRefs.current.push(null);
    }
    itemRefs.current.splice(idx, 1, el);
  }, []);

  const containerRefCallback = useCallback((node: DOMElement | null) => {
    createContainerRefCallback(
      containerRef,
      containerObserverRef,
      setContainerHeight,
      setContainerWidth,
    )(node);
  }, []);

  const itemsObserver = useMemo(() => createItemsObserver(nodeToKeyRef, setHeights), []);

  useLayoutEffect(
    () => () => {
      containerObserverRef.current?.disconnect();
      itemsObserver.disconnect();
    },
    [itemsObserver],
  );

  const { totalHeight, offsets } = useMemo(
    () => computeOffsetsAndTotalHeight(data, heights, estimatedItemHeight, keyExtractor),
    [heights, data, estimatedItemHeight, keyExtractor],
  );

  const scrollableContainerHeight = props.containerHeight ?? containerHeight;

  const getAnchorForScrollTop = useCallback(
    (scrollTop: number, scrollOffsets: number[]) =>
      findAnchorForScrollTop(scrollTop, scrollOffsets),
    [],
  );

  const prevOffsetsLengthRef = useRef(offsets.length);
  const [prevTargetScrollIndex, setPrevTargetScrollIndex] = useState(props.targetScrollIndex);
  updateTargetScrollIndexState(
    props.targetScrollIndex,
    offsets.length,
    prevTargetScrollIndex,
    setPrevTargetScrollIndex,
    prevOffsetsLengthRef,
    setIsStickingToBottom,
    setScrollAnchor,
  );

  const actualScrollTop = useMemo(
    () =>
      computeActualScrollTop(
        scrollAnchor,
        offsets,
        data,
        keyExtractor,
        heights,
        scrollableContainerHeight,
      ),
    [scrollAnchor, offsets, heights, scrollableContainerHeight, data, keyExtractor],
  );

  const scrollTop = isStickingToBottom ? Number.MAX_SAFE_INTEGER : actualScrollTop;

  useVirtualizedScrollManagement(
    data,
    totalHeight,
    actualScrollTop,
    scrollableContainerHeight,
    isStickingToBottom,
    setIsStickingToBottom,
    scrollAnchor,
    setScrollAnchor,
    getAnchorForScrollTop,
    offsets,
    props.targetScrollIndex,
  );

  useLayoutEffect(() => {
    applyInitialScroll(
      initialScrollIndex,
      initialScrollOffsetInIndex,
      offsets,
      totalHeight,
      scrollableContainerHeight,
      data.length,
      heights,
      props.targetScrollIndex,
      isInitialScrollSet,
      setScrollAnchor,
      setIsStickingToBottom,
      getAnchorForScrollTop,
    );
  }, [
    initialScrollIndex,
    initialScrollOffsetInIndex,
    offsets,
    totalHeight,
    scrollableContainerHeight,
    getAnchorForScrollTop,
    data.length,
    heights,
    props.targetScrollIndex,
  ]);

  const {
    startIndex,
    endIndex,
    topSpacerHeight,
    bottomSpacerHeight,
    renderRangeStart,
    renderRangeEnd,
  } = computeVisibleRange(
    offsets,
    actualScrollTop,
    scrollableContainerHeight,
    data.length,
    renderStatic,
    overflowToBackbuffer,
  );

  // Maintain a stable set of observed nodes using useLayoutEffect
  const observedNodes = useRef<Set<DOMElement>>(new Set());
  useLayoutEffect(() => {
    observeVisibleNodes(
      startIndex,
      endIndex,
      renderStatic,
      overflowToBackbuffer,
      data.length,
      itemRefs,
      data as unknown[],
      keyExtractor as unknown as (item: unknown, index: number) => string,
      isStatic,
      fixedItemHeight,
      observedNodes,
      itemsObserver,
      nodeToKeyRef,
    );
  });

  const isReady =
    containerHeight > 0 ||
    process.env['NODE_ENV'] === 'test' ||
    (props.width !== undefined && typeof props.width === 'number');

  return {
    containerRefCallback,
    totalHeight,
    offsets,
    actualScrollTop,
    scrollableContainerHeight,
    scrollAnchor,
    setScrollAnchor,
    isStickingToBottom,
    setIsStickingToBottom,
    getAnchorForScrollTop,
    startIndex,
    endIndex,
    topSpacerHeight,
    bottomSpacerHeight,
    renderRangeStart,
    renderRangeEnd,
    isReady,
    itemRefs,
    onSetRef,
    containerWidth,
    scrollTop,
  };
}

function VirtualizedList<T>(props: VirtualizedListProps<T>, ref: React.Ref<VirtualizedListRef<T>>) {
  const {
    data,
    renderItem,
    keyExtractor,
    renderStatic,
    isStaticItem,
    width,
    overflowToBackbuffer,
    scrollbar = true,
    stableScrollback,
    copyModeEnabled = false,
  } = props;

  const layout = useVirtualizedLayout(props);

  const renderedItems = useMemo(
    () =>
      buildRenderedItems({
        isReady: layout.isReady,
        renderRangeStart: layout.renderRangeStart,
        renderRangeEnd: layout.renderRangeEnd,
        data,
        startIndex: layout.startIndex,
        endIndex: layout.endIndex,
        renderStatic,
        isStaticItem,
        renderItem,
        keyExtractor,
        width,
        containerWidth: layout.containerWidth,
        onSetRef: layout.onSetRef,
      }),
    [
      layout.isReady,
      layout.renderRangeStart,
      layout.renderRangeEnd,
      data,
      layout.startIndex,
      layout.endIndex,
      renderStatic,
      isStaticItem,
      renderItem,
      keyExtractor,
      width,
      layout.containerWidth,
      layout.onSetRef,
    ],
  );

  const { getScrollTop, setPendingScrollTop } = useBatchedScroll(layout.scrollTop);

  useImperativeHandle(
    ref,
    () =>
      createScrollMethodImpls({
        offsets: layout.offsets,
        scrollAnchor: layout.scrollAnchor,
        totalHeight: layout.totalHeight,
        scrollableContainerHeight: layout.scrollableContainerHeight,
        getAnchorForScrollTop: layout.getAnchorForScrollTop,
        getScrollTop,
        setPendingScrollTop,
        setScrollAnchor: layout.setScrollAnchor,
        setIsStickingToBottom: layout.setIsStickingToBottom,
        data,
      }),
    [
      layout.offsets,
      layout.scrollAnchor,
      layout.totalHeight,
      layout.getAnchorForScrollTop,
      data,
      layout.scrollableContainerHeight,
      getScrollTop,
      setPendingScrollTop,
      layout.setScrollAnchor,
      layout.setIsStickingToBottom,
    ],
  );

  return (
    <Box
      ref={layout.containerRefCallback}
      overflowY={copyModeEnabled ? 'hidden' : 'scroll'}
      overflowX="hidden"
      scrollTop={copyModeEnabled ? 0 : layout.scrollTop}
      scrollbarThumbColor={props.scrollbarThumbColor ?? theme.text.secondary}
      backgroundColor={props.backgroundColor}
      width="100%"
      height="100%"
      flexDirection="column"
      paddingRight={copyModeEnabled ? 0 : 1}
      overflowToBackbuffer={overflowToBackbuffer}
      scrollbar={scrollbar}
      stableScrollback={stableScrollback}
    >
      <Box
        flexShrink={0}
        width="100%"
        flexDirection="column"
        marginTop={copyModeEnabled ? -layout.actualScrollTop : 0}
      >
        <Box height={layout.topSpacerHeight} flexShrink={0} />
        {renderedItems}
        <Box height={layout.bottomSpacerHeight} flexShrink={0} />
      </Box>
    </Box>
  );
}

const VirtualizedListWithForwardRef = forwardRef(VirtualizedList) as <T>(
  props: VirtualizedListProps<T> & { ref?: React.Ref<VirtualizedListRef<T>> },
) => React.ReactElement;

export { VirtualizedListWithForwardRef as VirtualizedList };

VirtualizedList.displayName = 'VirtualizedList';
