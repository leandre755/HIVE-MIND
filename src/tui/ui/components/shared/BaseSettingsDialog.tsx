import React, { useMemo, useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { theme } from '../../semantic-colors.js';
import type { LoadableSettingScope } from '../../../config/settings.js';
import type { SettingsType, SettingsValue } from '../../../config/settingsSchema.js';
import { getScopeItems } from '../../../utils/dialogScopeUtils.js';
import { RadioButtonSelect } from './RadioButtonSelect.js';
import { TextInput } from './TextInput.js';
import type { TextBuffer } from './text-buffer.js';
import { cpSlice, cpLen, cpIndexToOffset } from '../../utils/textUtils.js';
import { useKeypress, type Key } from '../../hooks/useKeypress.js';
import { Command, type KeyMatchers } from '../../key/keyMatchers.js';
import { useSettingsNavigation } from '../../hooks/useSettingsNavigation.js';
import { useInlineEditBuffer, type EditBufferAction } from '../../hooks/useInlineEditBuffer.js';
import { formatCommand } from '../../key/keybindingUtils.js';
import { useKeyMatchers } from '../../hooks/useKeyMatchers.js';

/**
 * Represents a single item in the settings dialog.
 */
export interface SettingsDialogItem {
  /** Unique identifier for the item */
  key: string;
  /** Display label */
  label: string;
  /** Optional description below label */
  description?: string;
  /** Item type for determining interaction behavior */
  type: SettingsType;
  /** Pre-formatted display value (with * if modified) */
  displayValue: string;
  /** Grey out value (at default) */
  isGreyedOut?: boolean;
  /** Scope message e.g., "(Modified in Workspace)" */
  scopeMessage?: string;
  /** Raw value for edit mode initialization */
  rawValue?: SettingsValue;
  /** Optional pre-formatted edit buffer value for complex types */
  editValue?: string;
}

/**
 * Props for BaseSettingsDialog component.
 */
export interface BaseSettingsDialogProps {
  // Header
  /** Dialog title displayed at the top */
  title: string;
  /** Optional border color for the dialog */
  borderColor?: string;
  // Search (optional feature)
  /** Whether to show the search input. Default: true */
  searchEnabled?: boolean;
  /** Placeholder text for search input. Default: "Search to filter" */
  searchPlaceholder?: string;
  /** Text buffer for search input */
  searchBuffer?: TextBuffer;

  // Items - parent provides the list
  /** List of items to display */
  items: SettingsDialogItem[];

  // Scope selector
  /** Whether to show the scope selector. Default: true */
  showScopeSelector?: boolean;
  /** Editable scope items to display. Defaults to all loadable scopes. */
  scopeItems?: Array<{
    label: string;
    value: LoadableSettingScope;
  }>;
  /** Currently selected scope */
  selectedScope: LoadableSettingScope;
  /** Callback when scope changes */
  onScopeChange?: (scope: LoadableSettingScope) => void;

  // Layout
  /** Maximum number of items to show at once */
  maxItemsToShow: number;
  /** Maximum label width for alignment */
  maxLabelWidth?: number;

  // Action callbacks
  /** Called when a boolean/enum item is toggled */
  onItemToggle: (key: string, item: SettingsDialogItem) => void;
  /** Called when edit mode is committed with new value */
  onEditCommit: (key: string, newValue: string, item: SettingsDialogItem) => void;
  /** Called when Ctrl+C is pressed to clear/reset an item */
  onItemClear: (key: string, item: SettingsDialogItem) => void;
  /** Called when dialog should close */
  onClose: () => void;
  /** Optional custom key handler for parent-specific keys. Return true if handled. */
  onKeyPress?: (key: Key, currentItem: SettingsDialogItem | undefined) => boolean;

  /** Optional override for key matchers used for navigation. */
  keyMatchers?: KeyMatchers;

  /** Available terminal height for dynamic windowing */
  availableHeight?: number;

  /** Optional footer configuration */
  footer?: {
    content: React.ReactNode;
    height: number;
  };
}

interface SettingsDialogKeyHandlerParams {
  key: Key;
  currentItem: BaseSettingsDialogProps['items'][number] | undefined;
  editingKey: string | null;
  onKeyPress: BaseSettingsDialogProps['onKeyPress'];
  editDispatch: (action: EditBufferAction) => void;
  commitEdit: () => void;
  moveUp: () => void;
  moveDown: () => void;
  keyMatchers: ReturnType<typeof useKeyMatchers>;
  effectiveFocusSection: 'settings' | 'scope';
  finalShowScopeSelector: boolean;
  setFocusSection: React.Dispatch<React.SetStateAction<'settings' | 'scope'>>;
  onClose: () => void;
  onItemToggle: BaseSettingsDialogProps['onItemToggle'];
  onItemClear: BaseSettingsDialogProps['onItemClear'];
  startEditing: (key: string, value: string) => void;
  items: BaseSettingsDialogProps['items'];
}

function handleEditModeKey(
  key: Key,
  editingKey: string,
  items: BaseSettingsDialogProps['items'],
  keyMatchers: ReturnType<typeof useKeyMatchers>,
  editDispatch: (action: EditBufferAction) => void,
  commitEdit: () => void,
  moveUp: () => void,
  moveDown: () => void,
): boolean {
  const item = items.find((i) => i.key === editingKey);
  const type = item?.type ?? 'string';

  if (keyMatchers[Command.MOVE_LEFT](key)) {
    editDispatch({ type: 'MOVE_LEFT' });
    return true;
  }
  if (keyMatchers[Command.MOVE_RIGHT](key)) {
    editDispatch({ type: 'MOVE_RIGHT' });
    return true;
  }
  if (keyMatchers[Command.HOME](key)) {
    editDispatch({ type: 'HOME' });
    return true;
  }
  if (keyMatchers[Command.END](key)) {
    editDispatch({ type: 'END' });
    return true;
  }
  if (keyMatchers[Command.DELETE_CHAR_LEFT](key)) {
    editDispatch({ type: 'DELETE_LEFT' });
    return true;
  }
  if (keyMatchers[Command.DELETE_CHAR_RIGHT](key)) {
    editDispatch({ type: 'DELETE_RIGHT' });
    return true;
  }
  if (keyMatchers[Command.ESCAPE](key)) {
    commitEdit();
    return true;
  }
  if (keyMatchers[Command.RETURN](key)) {
    commitEdit();
    return true;
  }

  if (keyMatchers[Command.DIALOG_NAVIGATION_UP](key) && !key.insertable) {
    commitEdit();
    moveUp();
    return true;
  }
  if (keyMatchers[Command.DIALOG_NAVIGATION_DOWN](key) && !key.insertable) {
    commitEdit();
    moveDown();
    return true;
  }

  if (key.sequence) {
    editDispatch({ type: 'INSERT_CHAR', char: key.sequence, isNumberType: type === 'number' });
  }
  return true;
}

function handleNavigationKey(
  key: Key,
  currentItem: BaseSettingsDialogProps['items'][number] | undefined,
  keyMatchers: ReturnType<typeof useKeyMatchers>,
  moveUp: () => void,
  moveDown: () => void,
  onItemToggle: BaseSettingsDialogProps['onItemToggle'],
  onItemClear: BaseSettingsDialogProps['onItemClear'],
  startEditing: (itemKey: string, value: string) => void,
): boolean {
  if (keyMatchers[Command.DIALOG_NAVIGATION_UP](key)) {
    moveUp();
    return true;
  }
  if (keyMatchers[Command.DIALOG_NAVIGATION_DOWN](key)) {
    moveDown();
    return true;
  }

  if (keyMatchers[Command.RETURN](key) && currentItem) {
    if (currentItem.type === 'boolean' || currentItem.type === 'enum') {
      onItemToggle(currentItem.key, currentItem);
    } else {
      const rawVal = currentItem.rawValue;
      const initialValue = currentItem.editValue ?? (rawVal !== undefined ? String(rawVal) : '');
      startEditing(currentItem.key, initialValue);
    }
    return true;
  }

  if (keyMatchers[Command.CLEAR_SCREEN](key) && currentItem) {
    onItemClear(currentItem.key, currentItem);
    return true;
  }

  if (currentItem?.type === 'number' && /^\d$/.test(key.sequence)) {
    startEditing(currentItem.key, key.sequence);
    return true;
  }

  return false;
}

function handleSettingsDialogKey({
  key,
  currentItem,
  editingKey,
  onKeyPress,
  editDispatch,
  commitEdit,
  moveUp,
  moveDown,
  keyMatchers,
  effectiveFocusSection,
  finalShowScopeSelector,
  setFocusSection,
  onClose,
  onItemToggle,
  onItemClear,
  startEditing,
  items,
}: SettingsDialogKeyHandlerParams): void {
  if (!editingKey && onKeyPress?.(key, currentItem)) {
    return;
  }

  if (editingKey) {
    handleEditModeKey(
      key,
      editingKey,
      items,
      keyMatchers,
      editDispatch,
      commitEdit,
      moveUp,
      moveDown,
    );
    return;
  }

  if (effectiveFocusSection === 'settings') {
    if (
      handleNavigationKey(
        key,
        currentItem,
        keyMatchers,
        moveUp,
        moveDown,
        onItemToggle,
        onItemClear,
        startEditing,
      )
    ) {
      return;
    }
  }

  if (key.name === 'tab' && finalShowScopeSelector) {
    setFocusSection((s) => (s === 'settings' ? 'scope' : 'settings'));
    return;
  }

  if (keyMatchers[Command.ESCAPE](key)) {
    onClose();
  }
}

interface SettingsItemRendererParams {
  item: BaseSettingsDialogProps['items'][number];
  isActive: boolean;
  editingKey: string | null;
  cursorVisible: boolean;
  editBuffer: string;
  editCursorPos: number;
  maxLabelWidth: number | undefined;
  theme: typeof theme;
}

function getSettingsItemDisplayValue(
  item: BaseSettingsDialogProps['items'][number],
  editingKey: string | null,
  cursorVisible: boolean,
  editBuffer: string,
  editCursorPos: number,
): string {
  if (editingKey !== item.key) {
    return item.displayValue;
  }
  if (cursorVisible && editCursorPos < cpLen(editBuffer)) {
    const beforeCursor = cpSlice(editBuffer, 0, editCursorPos);
    const atCursor = cpSlice(editBuffer, editCursorPos, editCursorPos + 1);
    const afterCursor = cpSlice(editBuffer, editCursorPos + 1);
    return beforeCursor + chalk.inverse(atCursor) + afterCursor;
  }
  if (editCursorPos >= cpLen(editBuffer)) {
    return editBuffer + (cursorVisible ? chalk.inverse(' ') : ' ');
  }
  return editBuffer;
}

function renderSettingsItem({
  item,
  isActive,
  editingKey,
  cursorVisible,
  editBuffer,
  editCursorPos,
  maxLabelWidth,
  theme: t,
}: SettingsItemRendererParams): React.JSX.Element {
  const displayValue = getSettingsItemDisplayValue(
    item,
    editingKey,
    cursorVisible,
    editBuffer,
    editCursorPos,
  );

  let itemColor = t.text.primary;
  if (isActive) {
    itemColor = t.ui.focus;
  } else if (item.isGreyedOut) {
    itemColor = t.text.secondary;
  }

  return (
    <React.Fragment key={item.key}>
      <Box
        marginX={1}
        flexDirection="row"
        alignItems="flex-start"
        backgroundColor={isActive ? t.background.focus : undefined}
      >
        <Box minWidth={2} flexShrink={0}>
          <Text color={isActive ? t.ui.focus : t.text.secondary}>{isActive ? '●' : ''}</Text>
        </Box>
        <Box flexDirection="row" flexGrow={1} minWidth={0} alignItems="flex-start">
          <Box flexDirection="column" width={maxLabelWidth} minWidth={0}>
            <Text color={isActive ? t.ui.focus : t.text.primary}>
              {item.label}
              {item.scopeMessage && <Text color={t.text.secondary}> {item.scopeMessage}</Text>}
            </Text>
            <Text color={t.text.secondary} wrap="truncate">
              {item.description ?? ''}
            </Text>
          </Box>
          <Box minWidth={3} />
          <Box flexShrink={0}>
            <Text
              color={itemColor}
              terminalCursorFocus={editingKey === item.key && cursorVisible}
              terminalCursorPosition={cpIndexToOffset(editBuffer, editCursorPos)}
            >
              {displayValue}
            </Text>
          </Box>
        </Box>
      </Box>
      <Box height={1} />
    </React.Fragment>
  );
}

interface LayoutCalculationParams {
  availableHeight: number | undefined;
  maxItemsToShow: number | undefined;
  itemsLength: number;
  searchEnabled: boolean;
  showAvailableScopes: boolean;
  footerHeight: number | undefined;
}

function calculateDialogLayout({
  availableHeight,
  maxItemsToShow,
  itemsLength,
  searchEnabled,
  showAvailableScopes,
  footerHeight,
}: LayoutCalculationParams): { effectiveMaxItemsToShow: number; finalShowScopeSelector: boolean } {
  if (!availableHeight) {
    return {
      effectiveMaxItemsToShow: maxItemsToShow ?? itemsLength,
      finalShowScopeSelector: showAvailableScopes,
    };
  }

  const DIALOG_PADDING = 4;
  const SETTINGS_TITLE_HEIGHT = 1;
  const SEARCH_SECTION_HEIGHT = searchEnabled ? 5 : 1;
  const SCROLL_ARROWS_HEIGHT = 2;
  const ITEMS_SPACING_AFTER = 1;
  const SCOPE_SECTION_HEIGHT = 5;
  const HELP_TEXT_HEIGHT = 1;
  const FOOTER_CONTENT_HEIGHT = footerHeight ?? 0;
  const ITEM_HEIGHT = 3;

  const currentAvailableHeight = availableHeight - DIALOG_PADDING;
  const baseFixedHeight =
    SETTINGS_TITLE_HEIGHT +
    SEARCH_SECTION_HEIGHT +
    SCROLL_ARROWS_HEIGHT +
    ITEMS_SPACING_AFTER +
    HELP_TEXT_HEIGHT +
    FOOTER_CONTENT_HEIGHT;

  const heightWithScope = baseFixedHeight + SCOPE_SECTION_HEIGHT;
  const availableForItemsWithScope = currentAvailableHeight - heightWithScope;
  const maxItemsWithScope = Math.max(1, Math.floor(availableForItemsWithScope / ITEM_HEIGHT));

  const availableForItemsWithoutScope = currentAvailableHeight - baseFixedHeight;
  const maxItemsWithoutScope = Math.max(1, Math.floor(availableForItemsWithoutScope / ITEM_HEIGHT));

  let shouldShowScope = showAvailableScopes;
  let maxItems = showAvailableScopes ? maxItemsWithScope : maxItemsWithoutScope;

  if (showAvailableScopes && availableHeight < 25) {
    if (maxItemsWithoutScope > maxItemsWithScope + 1) {
      shouldShowScope = false;
      maxItems = maxItemsWithoutScope;
    }
  }

  return {
    effectiveMaxItemsToShow: Math.min(maxItems, itemsLength),
    finalShowScopeSelector: shouldShowScope,
  };
}

interface DialogBodyProps {
  title: string;
  effectiveFocusSection: 'settings' | 'scope';
  editingKey: string | null;
  searchEnabled: boolean;
  searchBuffer: BaseSettingsDialogProps['searchBuffer'];
  searchPlaceholder: string;
  visibleItems: BaseSettingsDialogProps['items'];
  windowStart: number;
  activeIndex: number;
  cursorVisible: boolean;
  editBuffer: string;
  editCursorPos: number;
  maxLabelWidth: number | undefined;
  showScrollUp: boolean;
  showScrollDown: boolean;
  finalShowScopeSelector: boolean;
  scopeItems: Array<{ label: string; value: LoadableSettingScope; key: string }>;
  selectedScope: LoadableSettingScope | undefined;
  handleScopeChange: (scope: LoadableSettingScope) => void;
  effectiveFocusScope: 'settings' | 'scope';
  footer: BaseSettingsDialogProps['footer'];
  availableHeight: number | undefined;
}

function BaseSettingsDialogBody({
  title,
  effectiveFocusSection,
  editingKey,
  searchEnabled,
  searchBuffer,
  searchPlaceholder,
  visibleItems,
  windowStart,
  activeIndex,
  cursorVisible,
  editBuffer,
  editCursorPos,
  maxLabelWidth,
  showScrollUp,
  showScrollDown,
  finalShowScopeSelector,
  scopeItems,
  selectedScope,
  handleScopeChange,
  effectiveFocusScope,
  footer,
  availableHeight,
}: DialogBodyProps): React.JSX.Element {
  let searchBorderColor = theme.border.default;
  if (!editingKey && effectiveFocusSection === 'settings') {
    searchBorderColor = theme.ui.focus;
  }

  return (
    <Box
      borderStyle="round"
      borderColor={undefined}
      flexDirection="row"
      padding={1}
      width="100%"
      maxHeight={availableHeight}
    >
      <Box flexDirection="column" flexGrow={1}>
        <Box marginX={1}>
          <Text bold={effectiveFocusSection === 'settings' && !editingKey} wrap="truncate">
            {effectiveFocusSection === 'settings' ? '> ' : '  '}
            {title}{' '}
          </Text>
        </Box>

        {searchEnabled && searchBuffer && (
          <Box
            borderStyle="round"
            borderColor={searchBorderColor}
            paddingX={1}
            height={3}
            marginTop={1}
          >
            <TextInput
              focus={effectiveFocusSection === 'settings' && !editingKey}
              buffer={searchBuffer}
              placeholder={searchPlaceholder}
            />
          </Box>
        )}

        <Box height={1} />

        {visibleItems.length === 0 ? (
          <Box marginX={1} height={1} flexDirection="column">
            <Text color={theme.text.secondary}>No matches found.</Text>
          </Box>
        ) : (
          <>
            {showScrollUp && (
              <Box marginX={1}>
                <Text color={theme.text.secondary}>▲</Text>
              </Box>
            )}
            {visibleItems.map((item, idx) => {
              const globalIndex = idx + windowStart;
              const isActive = effectiveFocusSection === 'settings' && activeIndex === globalIndex;
              return renderSettingsItem({
                item,
                isActive,
                editingKey,
                cursorVisible,
                editBuffer,
                editCursorPos,
                maxLabelWidth,
                theme,
              });
            })}
            {showScrollDown && (
              <Box marginX={1}>
                <Text color={theme.text.secondary}>▼</Text>
              </Box>
            )}
          </>
        )}

        <Box height={1} />

        {finalShowScopeSelector && (
          <Box marginX={1} flexDirection="column">
            <Text bold={effectiveFocusScope === 'scope'} wrap="truncate">
              {effectiveFocusScope === 'scope' ? '> ' : '  '}Apply To
            </Text>
            <RadioButtonSelect
              items={scopeItems}
              initialIndex={scopeItems.findIndex((item) => item.value === selectedScope)}
              onSelect={handleScopeChange}
              onHighlight={handleScopeChange}
              isFocused={effectiveFocusScope === 'scope'}
              showNumbers={effectiveFocusScope === 'scope'}
              priority={effectiveFocusScope === 'scope'}
            />
          </Box>
        )}

        <Box height={1} />

        <Box marginX={1}>
          <Text color={theme.text.secondary}>
            (Use Enter to select, {formatCommand(Command.CLEAR_SCREEN)} to reset
            {finalShowScopeSelector ? ', Tab to change focus' : ''}, Esc to close)
          </Text>
        </Box>

        {footer && <Box marginX={1}>{footer.content}</Box>}
      </Box>
    </Box>
  );
}

/**
 * A base settings dialog component that handles rendering, layout, and keyboard navigation.
 * Parent components handle business logic (saving, filtering, etc.) via callbacks.
 */
export function BaseSettingsDialog({
  title,
  searchEnabled = true,
  searchPlaceholder = 'Search to filter',
  searchBuffer,
  items,
  showScopeSelector = true,
  scopeItems: providedScopeItems,
  selectedScope,
  onScopeChange,
  maxItemsToShow,
  maxLabelWidth,
  onItemToggle,
  onEditCommit,
  onItemClear,
  onClose,
  onKeyPress,
  keyMatchers: customKeyMatchers,
  availableHeight,
  footer,
}: BaseSettingsDialogProps): React.JSX.Element {
  const globalKeyMatchers = useKeyMatchers();
  const keyMatchers = customKeyMatchers ?? globalKeyMatchers;
  const scopeItems = useMemo(
    () =>
      (providedScopeItems ?? getScopeItems()).map((item) => ({
        ...item,
        key: item.value,
      })),
    [providedScopeItems],
  );
  const showAvailableScopes = showScopeSelector && scopeItems.length > 1;

  // Calculate effective max items and scope visibility based on terminal height
  const { effectiveMaxItemsToShow, finalShowScopeSelector } = useMemo(() => {
    return calculateDialogLayout({
      availableHeight,
      maxItemsToShow,
      itemsLength: items.length,
      searchEnabled,
      showAvailableScopes,
      footerHeight: footer?.height,
    });
  }, [availableHeight, maxItemsToShow, items.length, searchEnabled, showAvailableScopes, footer]);

  // Internal state
  const { activeIndex, windowStart, moveUp, moveDown } = useSettingsNavigation({
    items,
    maxItemsToShow: effectiveMaxItemsToShow,
  });

  const { editState, editDispatch, startEditing, commitEdit, cursorVisible } = useInlineEditBuffer({
    onCommit: (key, value) => {
      const itemToCommit = items.find((i) => i.key === key);
      if (itemToCommit) {
        onEditCommit(key, value, itemToCommit);
      }
    },
  });

  const { editingKey, buffer: editBuffer, cursorPos: editCursorPos } = editState;

  const [focusSection, setFocusSection] = useState<'settings' | 'scope'>('settings');
  const effectiveFocusSection =
    !finalShowScopeSelector && focusSection === 'scope' ? 'settings' : focusSection;

  // Calculate visible items based on scroll offset
  const visibleItems = items.slice(windowStart, windowStart + effectiveMaxItemsToShow);

  // Show scroll indicators if there are more items than can be displayed
  const showScrollUp = items.length > effectiveMaxItemsToShow;
  const showScrollDown = items.length > effectiveMaxItemsToShow;

  // Get current item
  const currentItem = items.at(activeIndex);

  // Handle scope changes (for RadioButtonSelect)
  const handleScopeChange = useCallback(
    (scope: LoadableSettingScope) => {
      onScopeChange?.(scope);
    },
    [onScopeChange],
  );

  // Keyboard handling
  useKeypress(
    (key: Key) => {
      handleSettingsDialogKey({
        key,
        currentItem,
        editingKey,
        onKeyPress,
        editDispatch,
        commitEdit,
        moveUp,
        moveDown,
        keyMatchers,
        effectiveFocusSection,
        finalShowScopeSelector,
        setFocusSection,
        onClose,
        onItemToggle,
        onItemClear,
        startEditing,
        items,
      });
    },
    {
      isActive: true,
      priority: effectiveFocusSection === 'settings',
    },
  );

  return (
    <BaseSettingsDialogBody
      title={title}
      effectiveFocusSection={effectiveFocusSection}
      editingKey={editingKey}
      searchEnabled={searchEnabled}
      searchBuffer={searchBuffer}
      searchPlaceholder={searchPlaceholder}
      visibleItems={visibleItems}
      windowStart={windowStart}
      activeIndex={activeIndex}
      cursorVisible={cursorVisible}
      editBuffer={editBuffer}
      editCursorPos={editCursorPos}
      maxLabelWidth={maxLabelWidth}
      showScrollUp={showScrollUp}
      showScrollDown={showScrollDown}
      finalShowScopeSelector={finalShowScopeSelector}
      scopeItems={scopeItems}
      selectedScope={selectedScope}
      handleScopeChange={handleScopeChange}
      effectiveFocusScope={effectiveFocusSection}
      footer={footer}
      availableHeight={availableHeight}
    />
  );
}
