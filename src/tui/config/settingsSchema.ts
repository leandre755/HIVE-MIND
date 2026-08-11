export type {
  Settings,
  MergedSettings,
  SettingDefinition,
  SettingsSchema,
  SettingsType,
  SettingsValue,
} from './hiveSettingsSchema.js';

export interface SettingEnumOption {
  label: string;
  value: string;
}

export type SettingScope = 'user' | 'workspace' | 'global';

export type LoadableSettingScope = SettingScope | 'memory';

export interface LoadedSettings {
  scope: LoadableSettingScope;
  settings: Record<string, unknown>;
}
