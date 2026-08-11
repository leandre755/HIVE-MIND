import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text } from 'ink';
import { AsyncFzf } from 'fzf';
import { type Key } from '../hooks/useKeypress.js';
import { theme } from '../semantic-colors.js';
import {
  SettingScope,
  type LoadableSettingScope,
  type Settings,
  type SettingsType,
  type SettingsValue,
  TOGGLE_TYPES,
} from '../../config/settings.js';
import { getScopeItems, getScopeMessageForSetting } from '../../utils/dialogScopeUtils.js';
import {
  getDialogSettingKeys,
  getDisplayValue,
  getSettingDefinition,
  getDialogRestartRequiredSettings,
  getEffectiveValue,
  isInSettingsScope,
  getEditValue,
  parseEditedValue,
} from '../../utils/settingsUtils.js';
import { useSettingsStore, type SettingsState } from '../contexts/SettingsContext.js';
import { getCachedStringWidth } from '../utils/textUtils.js';
import { debugLogger } from '../../utils/errors.js';

import { useSearchBuffer } from '../hooks/useSearchBuffer.js';
import { BaseSettingsDialog, type SettingsDialogItem } from './shared/BaseSettingsDialog.js';
import { useKeyMatchers } from '../hooks/useKeyMatchers.js';
import { Command, KeyBinding } from '../key/keyBindings.js';

interface SettingsDialogProps {
  onSelect: (settingName: string | undefined, scope: SettingScope) => void;
  onRestartRequest?: () => void;
  availableTerminalHeight?: number;
}

const MAX_ITEMS_TO_SHOW = 8;

const KEY_UP = new KeyBinding('up');
const KEY_CTRL_P = new KeyBinding('ctrl+p');
const KEY_DOWN = new KeyBinding('down');
const KEY_CTRL_N = new KeyBinding('ctrl+n');

// Create a snapshot of the initial per-scope state of Restart Required Settings
// This creates a nested map of the form
// restartRequiredSetting -> Map { scopeName -> value }
function getActiveRestartRequiredSettings(
  settings: SettingsState,
): Map<string, Map<string, string>> {
  const snapshot = new Map<string, Map<string, string>>();
  const scopes: Array<[string, Settings]> = [
    ['User', settings.user.settings],
    ['Workspace', settings.workspace.settings],
    ['System', settings.system.settings],
  ];

  for (const key of getDialogRestartRequiredSettings()) {
    const scopeMap = new Map<string, string>();
    for (const [scopeName, scopeSettings] of scopes) {
      // Raw per-scope value (undefined if not in file)
      const value = isInSettingsScope(key, scopeSettings)
        ? getEffectiveValue(key, scopeSettings)
        : undefined;
      scopeMap.set(scopeName, JSON.stringify(value));
    }
    snapshot.set(key, scopeMap);
  }
  return snapshot;
}

function createSearchSetup() {
  const keys = getDialogSettingKeys();
  const map = new Map<string, string>();
  const searchItems: string[] = [];
  keys.forEach((key) => {
    const def = getSettingDefinition(key);
    if (def?.label) {
      searchItems.push(def.label);
      map.set(def.label.toLowerCase(), key);
    }
  });
  const fzf = new AsyncFzf(searchItems, { fuzzy: 'v2', casing: 'case-insensitive' });
  return { fzfInstance: fzf, searchMap: map };
}

function computeSettingsItems(
  settingKeys: string[],
  effectiveSelectedScope: LoadableSettingScope,
  settings: ReturnType<typeof useSettingsStore>['settings'],
): SettingsDialogItem[] {
  const scopeSettings = settings.forScope(effectiveSelectedScope).settings;
  const mergedSettings = settings.merged;
  return settingKeys.map((key) => {
    const definition = getSettingDefinition(key);
    const type: SettingsType = definition?.type ?? 'string';
    const displayValue = getDisplayValue(key, scopeSettings, mergedSettings);
    const scopeMessage = getScopeMessageForSetting(key, effectiveSelectedScope, settings);
    const isGreyedOut = !isInSettingsScope(key, scopeSettings);
    const rawValue = getEffectiveValue(key, scopeSettings);
    const editValue = getEditValue(type, rawValue);
    return {
      key,
      label: definition?.label || key,
      description: definition?.description,
      type,
      displayValue,
      isGreyedOut,
      scopeMessage,
      rawValue,
      editValue,
    };
  });
}

function computeToggleValue(key: string, scopeSettings: Settings): SettingsValue | undefined {
  const definition = getSettingDefinition(key);
  if (!definition?.type || !TOGGLE_TYPES.has(definition.type)) return undefined;
  const currentValue = getEffectiveValue(key, scopeSettings);
  if (definition?.type === 'boolean') {
    return typeof currentValue === 'boolean' ? !currentValue : undefined;
  }
  if (definition?.type === 'enum' && definition.options && definition.options.length > 0) {
    const options = definition.options;
    const currentIndex = options.findIndex((opt) => opt.value === currentValue);
    return currentIndex !== -1 && currentIndex < options.length - 1
      ? options[currentIndex + 1].value
      : options[0].value;
  }
  return undefined;
}

export function SettingsDialog({
  onSelect,
  onRestartRequest,
  availableTerminalHeight,
}: SettingsDialogProps): React.JSX.Element {
  // Reactive settings from store (re-renders on any settings change)
  const { settings, setSetting } = useSettingsStore();

  const [selectedScope, setSelectedScope] = useState<LoadableSettingScope>(SettingScope.User);
  const editableScopeItems = useMemo(
    () =>
      getScopeItems().filter((item) => {
        const settingsFile = settings.forScope(item.value);
        return (
          settingsFile.readOnly !== true &&
          (item.value !== SettingScope.Workspace || settingsFile.path !== undefined)
        );
      }),
    [settings],
  );
  const writableSelectedScope =
    editableScopeItems.find((item) => item.value === selectedScope)?.value ??
    editableScopeItems[0]?.value;
  const effectiveSelectedScope = writableSelectedScope ?? SettingScope.User;

  if (writableSelectedScope && selectedScope !== writableSelectedScope) {
    setSelectedScope(writableSelectedScope);
  }

  // Snapshot restart-required values at mount time for diff tracking
  const [activeRestartRequiredSettings] = useState(() =>
    getActiveRestartRequiredSettings(settings),
  );

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredKeys, setFilteredKeys] = useState<string[]>(() => getDialogSettingKeys());
  const { fzfInstance, searchMap } = useMemo(() => createSearchSetup(), []);

  // Perform search
  useEffect(() => {
    let active = true;
    if (!searchQuery.trim() || !fzfInstance) {
      setFilteredKeys(getDialogSettingKeys());
      return;
    }

    const doSearch = async () => {
      const results = await fzfInstance.find(searchQuery);

      if (!active) return;

      const matchedKeys = new Set<string>();
      results.forEach((res: { item: string }) => {
        const key = searchMap.get(res.item.toLowerCase());
        if (key) matchedKeys.add(key);
      });
      setFilteredKeys(Array.from(matchedKeys));
    };

    doSearch();

    return () => {
      active = false;
    };
  }, [searchQuery, fzfInstance, searchMap]);

  // Track whether a restart is required to apply the changes in the Settings json file
  // This does not care for inheritance
  // It checks whether a proposed change from this UI to a settings.json file requires a restart to take effect in the app
  const pendingRestartRequiredSettings = useMemo(() => {
    const changed = new Set<string>();
    const scopes: Array<[string, Settings]> = [
      ['User', settings.user.settings],
      ['Workspace', settings.workspace.settings],
      ['System', settings.system.settings],
    ];

    // Iterate through the nested map snapshot in activeRestartRequiredSettings, diff with current settings
    for (const [key, initialScopeMap] of activeRestartRequiredSettings) {
      for (const [scopeName, scopeSettings] of scopes) {
        const currentValue = isInSettingsScope(key, scopeSettings)
          ? getEffectiveValue(key, scopeSettings)
          : undefined;
        const initialJson = initialScopeMap.get(scopeName);
        if (JSON.stringify(currentValue) !== initialJson) {
          changed.add(key);
          break; // one scope changed is enough
        }
      }
    }
    return changed;
  }, [settings, activeRestartRequiredSettings]);

  const showRestartPrompt = pendingRestartRequiredSettings.size > 0;

  // Calculate max width for the left column (Label/Description) to keep values aligned or close
  const maxLabelOrDescriptionWidth = useMemo(() => {
    const allKeys = getDialogSettingKeys();
    let max = 0;
    for (const key of allKeys) {
      const def = getSettingDefinition(key);
      if (!def) continue;

      const scopeMessage = getScopeMessageForSetting(key, effectiveSelectedScope, settings);
      const label = def.label || key;
      const labelFull = label + (scopeMessage ? ` ${scopeMessage}` : '');
      const lWidth = getCachedStringWidth(labelFull);
      const dWidth = def.description ? getCachedStringWidth(def.description) : 0;

      max = Math.max(max, lWidth, dWidth);
    }
    return max;
  }, [effectiveSelectedScope, settings]);

  // Search input buffer
  const searchBuffer = useSearchBuffer({
    initialText: '',
    onChange: setSearchQuery,
  });

  // Generate items for BaseSettingsDialog
  const settingKeys = searchQuery ? filteredKeys : getDialogSettingKeys();
  const items: SettingsDialogItem[] = useMemo(
    () => computeSettingsItems(settingKeys, effectiveSelectedScope, settings),
    [settingKeys, effectiveSelectedScope, settings],
  );

  const handleScopeChange = useCallback((scope: LoadableSettingScope) => {
    setSelectedScope(scope);
  }, []);

  const handleItemToggle = useCallback(
    (key: string, _item: SettingsDialogItem) => {
      if (!writableSelectedScope) return;
      const scopeSettings = settings.forScope(writableSelectedScope).settings;
      const newValue = computeToggleValue(key, scopeSettings);
      if (newValue === undefined) return;
      debugLogger.log(`[DEBUG SettingsDialog] Saving ${key} immediately with value:`, newValue);
      setSetting(writableSelectedScope, key, newValue);
    },
    [settings, writableSelectedScope, setSetting],
  );

  const handleEditCommit = useCallback(
    (key: string, newValue: string, _item: SettingsDialogItem) => {
      if (!writableSelectedScope) return;
      const definition = getSettingDefinition(key);
      const type: SettingsType = definition?.type ?? 'string';
      const parsed = parseEditedValue(type, newValue);
      if (parsed === null) return;
      setSetting(writableSelectedScope, key, parsed);
    },
    [writableSelectedScope, setSetting],
  );

  const handleItemClear = useCallback(
    (key: string, _item: SettingsDialogItem) => {
      if (!writableSelectedScope) return;
      setSetting(writableSelectedScope, key, undefined);
    },
    [writableSelectedScope, setSetting],
  );

  const handleClose = useCallback(() => {
    onSelect(undefined, effectiveSelectedScope as SettingScope);
  }, [onSelect, effectiveSelectedScope]);

  const globalKeyMatchers = useKeyMatchers();
  const settingsKeyMatchers = useMemo(
    () => ({
      ...globalKeyMatchers,
      [Command.DIALOG_NAVIGATION_UP]: (key: Key) => KEY_UP.matches(key) || KEY_CTRL_P.matches(key),
      [Command.DIALOG_NAVIGATION_DOWN]: (key: Key) =>
        KEY_DOWN.matches(key) || KEY_CTRL_N.matches(key),
    }),
    [globalKeyMatchers],
  );

  // Custom key handler for restart key
  const handleKeyPress = useCallback(
    (key: Key, _currentItem: SettingsDialogItem | undefined): boolean => {
      // 'r' key for restart
      if (showRestartPrompt && key.sequence === 'r') {
        if (onRestartRequest) onRestartRequest();
        return true;
      }
      return false;
    },
    [showRestartPrompt, onRestartRequest],
  );

  // Decisions on what features to enable
  const showSearch = !showRestartPrompt;

  return (
    <BaseSettingsDialog
      title="Settings"
      borderColor={showRestartPrompt ? theme.status.warning : undefined}
      searchEnabled={showSearch}
      searchBuffer={searchBuffer}
      items={items}
      showScopeSelector={editableScopeItems.length > 1}
      scopeItems={editableScopeItems}
      selectedScope={effectiveSelectedScope}
      onScopeChange={handleScopeChange}
      maxItemsToShow={MAX_ITEMS_TO_SHOW}
      availableHeight={availableTerminalHeight}
      maxLabelWidth={maxLabelOrDescriptionWidth}
      onItemToggle={handleItemToggle}
      onEditCommit={handleEditCommit}
      onItemClear={handleItemClear}
      onClose={handleClose}
      onKeyPress={handleKeyPress}
      keyMatchers={settingsKeyMatchers}
      footer={
        showRestartPrompt
          ? {
              content: (
                <Text color={theme.status.warning}>
                  Changes that require a restart have been modified. Press r to exit and apply
                  changes now.
                </Text>
              ),
              height: 1,
            }
          : undefined
      }
    />
  );
}
