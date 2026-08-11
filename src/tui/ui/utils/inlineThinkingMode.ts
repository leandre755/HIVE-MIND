import type { LoadedSettings } from '../../config/settings.js';

export type InlineThinkingMode = 'off' | 'full';

export function getInlineThinkingMode(settings: LoadedSettings): InlineThinkingMode {
  return (settings.merged.ui?.inlineThinkingMode as InlineThinkingMode) ?? 'off';
}
