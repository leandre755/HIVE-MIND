import React, { useCallback, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import {
  SettingScope,
  type LoadableSettingScope,
  type LoadedSettings,
} from '../../config/settings.js';
import { themeManager, DEFAULT_THEME } from '../themes/theme-manager.js';
import { pickDefaultThemeName, type Theme } from '../themes/theme.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import { DiffRenderer } from './messages/DiffRenderer.js';
import { colorizeCode } from '../utils/CodeColorizer.js';
import { getScopeMessageForSetting } from '../../utils/dialogScopeUtils.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { useAlternateBuffer } from '../hooks/useAlternateBuffer.js';
import { ScopeSelector } from './shared/ScopeSelector.js';
import { useUIState } from '../contexts/UIStateContext.js';
import { ColorsDisplay } from './ColorsDisplay.js';
import { isDevelopment } from '../../utils/installationInfo.js';

interface ThemeDialogProps {
  /** Callback function when a theme is selected */
  onSelect: (themeName: string, scope: LoadableSettingScope) => void | Promise<void>;

  /** Callback function when the dialog is cancelled */
  onCancel: () => void;

  /** Callback function when a theme is highlighted */
  onHighlight: (themeName: string | undefined) => void;
  /** The settings object */
  settings: LoadedSettings;
  availableTerminalHeight?: number;
  terminalWidth: number;
}

import { resolveColor } from '../themes/color-utils.js';

function generateThemeItem(
  name: string,
  typeDisplay: string,
  fullTheme: Theme | undefined,
  terminalBackgroundColor: string | undefined,
) {
  const isCompatible = fullTheme
    ? themeManager.isThemeCompatible(fullTheme, terminalBackgroundColor)
    : true;

  const themeBackground = fullTheme ? resolveColor(fullTheme.colors.Background) : undefined;

  const isBackgroundMatch =
    terminalBackgroundColor &&
    themeBackground &&
    terminalBackgroundColor.toLowerCase() === themeBackground.toLowerCase();

  return {
    label: name,
    value: name,
    themeNameDisplay: name,
    themeTypeDisplay: typeDisplay,
    themeWarning: isCompatible ? '' : ' (Incompatible)',
    themeMatch: isBackgroundMatch ? ' (Matches terminal)' : '',
    key: name,
    isCompatible,
  };
}

import {
  DIALOG_PADDING,
  PREVIEW_PANE_FIXED_VERTICAL_SPACE,
  PREVIEW_PANE_WIDTH_PERCENTAGE,
  PREVIEW_PANE_WIDTH_SAFETY_MARGIN,
  SELECTION_PANE_WIDTH_PERCENTAGE,
  TAB_TO_SELECT_HEIGHT,
  TOTAL_HORIZONTAL_PADDING,
} from './ThemeDialog.constants.js';

function generateThemeList(terminalBackgroundColor: string) {
  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return themeManager
    .getAvailableThemes()
    .map((themeItem) => {
      const fullTheme = themeManager.getTheme(themeItem.name);
      const capitalizedType = capitalize(themeItem.type);
      const typeDisplay = themeItem.name.endsWith(capitalizedType) ? '' : capitalizedType;
      return generateThemeItem(themeItem.name, typeDisplay, fullTheme, terminalBackgroundColor);
    })
    .sort((a, b) => {
      if (a.isCompatible && !b.isCompatible) return -1;
      if (!a.isCompatible && b.isCompatible) return 1;
      return a.label.localeCompare(b.label);
    });
}

function computeThemeLayout(
  availableTerminalHeight: number | undefined,
  selectThemeHeight: number,
) {
  let adjusted = availableTerminalHeight ?? Number.MAX_SAFE_INTEGER;
  adjusted -= 2;
  adjusted -= TAB_TO_SELECT_HEIGHT;
  let totalLeftHandSideHeight = DIALOG_PADDING + selectThemeHeight;
  let includePadding = true;
  if (totalLeftHandSideHeight > (availableTerminalHeight ?? Number.MAX_SAFE_INTEGER)) {
    includePadding = false;
    totalLeftHandSideHeight -= DIALOG_PADDING;
  }
  adjusted = Math.max(adjusted, totalLeftHandSideHeight);
  const availableTerminalHeightCodeBlock =
    adjusted - PREVIEW_PANE_FIXED_VERTICAL_SPACE - (includePadding ? 2 : 0) * 2;
  const availableHeightForPanes = Math.max(0, availableTerminalHeightCodeBlock - 1);
  const codeBlockHeight = Math.ceil(availableHeightForPanes * 0.6);
  const diffHeight = Math.floor(availableHeightForPanes * 0.4);
  return { includePadding, codeBlockHeight, diffHeight };
}

type ThemeItemWithExtras = { key: string; label: string; value: string; isCompatible: boolean } & {
  themeWarning?: string;
  themeMatch?: string;
  themeNameDisplay?: string;
  themeTypeDisplay?: string;
};

function renderThemeItem(item: ThemeItemWithExtras, titleColor: string) {
  if (item.themeNameDisplay) {
    const match = item.themeNameDisplay.match(/^(.*) \((.*)\)$/);
    const themeNamePart = match ? (
      <>
        {match[1]} <Text color={theme.text.secondary}>({match[2]})</Text>
      </>
    ) : (
      item.themeNameDisplay
    );
    return (
      <Text color={titleColor} wrap="truncate" key={item.key}>
        {themeNamePart}
        {item.themeTypeDisplay ? (
          <>
            {' '}
            <Text color={theme.text.secondary}>{item.themeTypeDisplay}</Text>
          </>
        ) : null}
        {item.themeMatch && <Text color={theme.status.success}>{item.themeMatch}</Text>}
        {item.themeWarning && <Text color={theme.status.warning}>{item.themeWarning}</Text>}
      </Text>
    );
  }
  return (
    <Text color={titleColor} wrap="truncate">
      {item.label}
    </Text>
  );
}

function getInitialThemeName(mergedTheme: unknown, terminalBackgroundColor: unknown): string {
  if (mergedTheme) {
    return mergedTheme as string;
  }
  return pickDefaultThemeName(
    terminalBackgroundColor as string | undefined,
    themeManager.getAllThemes(),
    DEFAULT_THEME.name,
    'Default Light',
  );
}

function handleThemeDialogKeys(
  key: Parameters<Parameters<typeof useKeypress>[0]>[0],
  updateMode: React.Dispatch<React.SetStateAction<'theme' | 'scope'>>,
  cancelFn: () => void,
): boolean {
  if (key.name === 'tab') {
    updateMode((prev) => (prev === 'theme' ? 'scope' : 'theme'));
    return true;
  }
  if (key.name === 'escape') {
    cancelFn();
    return true;
  }
  return false;
}

export function ThemeDialog({
  onSelect,
  onCancel,
  onHighlight,
  settings,
  availableTerminalHeight,
  terminalWidth,
}: ThemeDialogProps): React.JSX.Element {
  const isAlternateBuffer = useAlternateBuffer();
  const { terminalBackgroundColor } = useUIState();
  const [selectedScope, setSelectedScope] = useState<LoadableSettingScope>(SettingScope.User);

  // Track the currently highlighted theme name
  const [highlightedThemeName, setHighlightedThemeName] = useState<string>(() =>
    getInitialThemeName(settings.merged.ui.theme, terminalBackgroundColor),
  );

  const themeItems = useMemo(
    () => generateThemeList(String(terminalBackgroundColor)),
    [terminalBackgroundColor],
  );

  const initialThemeIndex = themeItems.findIndex((item) => item.value === highlightedThemeName);
  const safeInitialThemeIndex = initialThemeIndex >= 0 ? initialThemeIndex : 0;

  const handleThemeSelect = useCallback(
    async (themeName: string) => {
      await onSelect(themeName, selectedScope);
    },
    [onSelect, selectedScope],
  );

  const handleThemeHighlight = (themeName: string) => {
    setHighlightedThemeName(themeName);
    onHighlight(themeName);
  };

  const handleScopeHighlight = useCallback((scope: LoadableSettingScope) => {
    setSelectedScope(scope);
  }, []);

  const handleScopeSelect = useCallback(
    async (scope: LoadableSettingScope) => {
      await onSelect(highlightedThemeName, scope);
    },
    [onSelect, highlightedThemeName],
  );

  const [mode, setMode] = useState<'theme' | 'scope'>('theme');

  useKeypress((key) => handleThemeDialogKeys(key, setMode, onCancel), { isActive: true });

  // Generate scope message for theme setting
  const otherScopeModifiedMessage = getScopeMessageForSetting('ui.theme', selectedScope, settings);

  const colorizeCodeWidth = Math.max(
    Math.floor(
      (terminalWidth - TOTAL_HORIZONTAL_PADDING) *
        PREVIEW_PANE_WIDTH_PERCENTAGE *
        PREVIEW_PANE_WIDTH_SAFETY_MARGIN,
    ),
    1,
  );
  const { includePadding, codeBlockHeight, diffHeight } = computeThemeLayout(
    availableTerminalHeight,
    themeItems.length + 1,
  );
  const previewTheme =
    themeManager.getTheme(highlightedThemeName || DEFAULT_THEME.name) || DEFAULT_THEME;
  const leftColumnWidth = `${SELECTION_PANE_WIDTH_PERCENTAGE * 100}%`;
  const rightColumnWidth = `${PREVIEW_PANE_WIDTH_PERCENTAGE * 100}%`;

  return (
    <Box
      borderStyle="round"
      borderColor={theme.border.default}
      flexDirection="column"
      paddingTop={includePadding ? 1 : 0}
      paddingBottom={includePadding ? 1 : 0}
      paddingLeft={1}
      paddingRight={1}
      width="100%"
    >
      {mode === 'theme' ? (
        <Box flexDirection="row">
          {/* Left Column: Selection */}
          <Box flexDirection="column" width={leftColumnWidth} paddingRight={2}>
            <Text bold={mode === 'theme'} wrap="truncate">
              {mode === 'theme' ? '> ' : '  '}Select Theme{' '}
              <Text color={theme.text.secondary}>{otherScopeModifiedMessage}</Text>
            </Text>
            <RadioButtonSelect
              items={themeItems}
              initialIndex={safeInitialThemeIndex}
              onSelect={handleThemeSelect}
              onHighlight={handleThemeHighlight}
              isFocused={mode === 'theme'}
              maxItemsToShow={12}
              showScrollArrows={true}
              showNumbers={mode === 'theme'}
              renderItem={(item, { titleColor }) =>
                renderThemeItem(item as ThemeItemWithExtras, titleColor)
              }
            />
          </Box>

          {/* Right Column: Preview */}
          <ThemePreviewPane
            rightColumnWidth={rightColumnWidth}
            includePadding={includePadding}
            codeBlockHeight={codeBlockHeight}
            colorizeCodeWidth={colorizeCodeWidth}
            diffHeight={diffHeight}
            isAlternateBuffer={isAlternateBuffer}
            previewTheme={previewTheme}
            settings={settings}
          />
        </Box>
      ) : (
        <ScopeSelector
          onSelect={handleScopeSelect}
          onHighlight={handleScopeHighlight}
          isFocused={mode === 'scope'}
          initialScope={selectedScope}
        />
      )}
      <Box marginTop={1}>
        <Text color={theme.text.secondary} wrap="truncate">
          (Use Enter to {mode === 'theme' ? 'select' : 'apply scope'}, Tab to{' '}
          {mode === 'theme' ? 'configure scope' : 'select theme'}, Esc to close)
        </Text>
      </Box>
    </Box>
  );
}

function ThemePreviewPane({
  rightColumnWidth,
  includePadding,
  codeBlockHeight,
  colorizeCodeWidth,
  diffHeight,
  isAlternateBuffer,
  previewTheme,
  settings,
}: {
  rightColumnWidth: string;
  includePadding: boolean;
  codeBlockHeight: number;
  colorizeCodeWidth: number;
  diffHeight: number;
  isAlternateBuffer: boolean;
  previewTheme: Theme;
  settings: LoadedSettings;
}) {
  return (
    <Box flexDirection="column" width={rightColumnWidth} paddingLeft={2}>
      <Text bold color={theme.text.primary}>
        Preview
      </Text>
      <Box
        borderStyle="single"
        borderColor={theme.border.default}
        paddingTop={includePadding ? 1 : 0}
        paddingBottom={includePadding ? 1 : 0}
        paddingLeft={1}
        paddingRight={1}
        flexDirection="column"
      >
        {colorizeCode({
          code: `# function
def fibonacci(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a`,
          language: 'python',
          availableHeight: isAlternateBuffer === false ? codeBlockHeight : undefined,
          maxWidth: colorizeCodeWidth,
          settings,
        })}
        <Box marginTop={1} />
        <DiffRenderer
          diffContent={`--- a/util.py
+++ b/util.py
@@ -1,2 +1,2 @@
- print("Hello, " + name)
+ print(f"Hello, {name}!")
`}
          availableTerminalHeight={isAlternateBuffer === false ? diffHeight : undefined}
          terminalWidth={colorizeCodeWidth}
          theme={previewTheme}
        />
      </Box>
      {isDevelopment && (
        <Box marginTop={1}>
          <ColorsDisplay activeTheme={previewTheme} />
        </Box>
      )}
    </Box>
  );
}
