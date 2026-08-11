/**
 * @license
 * Copyright 2025 HIVE-MIND
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CSSProperties } from 'react';

import type { SemanticColors, CustomTheme } from './types.js';
import {
  DEFAULT_INPUT_BACKGROUND_OPACITY,
  DEFAULT_SELECTION_OPACITY,
  DEFAULT_BORDER_OPACITY,
} from '../constants.js';
import tinygradientPkg from 'tinygradient';
import tinycolor from 'tinycolor2';

const tinygradient = tinygradientPkg;

// Define the set of Ink's named colors for quick lookup
export const INK_SUPPORTED_NAMES = new Set([
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'cyan',
  'magenta',
  'white',
  'gray',
  'grey',
  'blackbright',
  'redbright',
  'greenbright',
  'yellowbright',
  'bluebright',
  'cyanbright',
  'magentabright',
  'whitebright',
]);

// Use tinycolor's built-in names map for CSS colors, excluding ones Ink supports
export const CSS_NAME_TO_HEX_MAP = Object.fromEntries(
  Object.entries(tinycolor.names)
    .filter(([name]) => !INK_SUPPORTED_NAMES.has(name))
    .map(([name, hex]) => [name, `#${hex}`]),
);

// Mapping for ANSI bright colors that are not in tinycolor's standard CSS names
export const INK_NAME_TO_HEX_MAP: Readonly<Record<string, string>> = {
  blackbright: '#555555',
  redbright: '#ff5555',
  greenbright: '#55ff55',
  yellowbright: '#ffff55',
  bluebright: '#5555ff',
  magentabright: '#ff55ff',
  cyanbright: '#55ffff',
  whitebright: '#ffffff',
};

/**
 * Calculates the relative luminance of a color.
 * See https://www.w3.org/TR/WCAG20/#relativeluminancedef
 *
 * @param color Color string (hex or Ink-supported name)
 * @returns Luminance value (0-255)
 */
export function getLuminance(color: string): number {
  const resolved = color.toLowerCase();
  const hex = (Reflect.get(INK_NAME_TO_HEX_MAP, resolved) as string | undefined) || resolved;

  const colorObj = tinycolor(hex);
  if (!colorObj.isValid()) {
    return 0;
  }

  // tinycolor returns 0-1, we need 0-255
  return colorObj.getLuminance() * 255;
}

/**
 * Resolves a CSS color value (name or hex) into an Ink-compatible color string.
 * @param colorValue The raw color string (e.g., 'blue', '#ff0000', 'darkkhaki').
 * @returns An Ink-compatible color string (hex or name), or undefined if not resolvable.
 */
export function resolveColor(colorValue: string): string | undefined {
  const lowerColor = colorValue.toLowerCase();

  // 1. Check if it's already a hex code and valid
  if (lowerColor.startsWith('#')) {
    if (/^#[0-9A-Fa-f]{6}$|^#[0-9A-Fa-f]{3}$/.test(colorValue)) {
      return lowerColor;
    } else {
      return undefined;
    }
  }

  // Handle hex codes without #
  if (/^[0-9A-Fa-f]{6}$|^[0-9A-Fa-f]{3}$/.test(colorValue)) {
    return `#${lowerColor}`;
  }

  // 2. Check if it's an Ink supported name (lowercase)
  if (INK_SUPPORTED_NAMES.has(lowerColor)) {
    return lowerColor; // Use Ink name directly
  }

  // 3. Check if it's a known CSS name we can map to hex
  // We can't import CSS_NAME_TO_HEX_MAP here due to circular deps,
  // but we can use tinycolor directly for named colors.
  const colorObj = tinycolor(lowerColor);
  if (colorObj.isValid()) {
    return colorObj.toHexString();
  }

  // 4. Could not resolve
  return undefined;
}

export function interpolateColor(color1: string, color2: string, factor: number) {
  if (factor <= 0 && color1) {
    return color1;
  }
  if (factor >= 1 && color2) {
    return color2;
  }
  if (!color1 || !color2) {
    return '';
  }
  try {
    const gradient = tinygradient(color1, color2);
    const color = gradient.rgbAt(factor);
    return color.toHexString();
  } catch {
    return color1;
  }
}

export function getThemeTypeFromBackgroundColor(
  backgroundColor: string | undefined,
): 'light' | 'dark' | undefined {
  if (!backgroundColor) {
    return undefined;
  }

  const resolvedColor = resolveColor(backgroundColor);
  if (!resolvedColor) {
    return undefined;
  }

  const luminance = getLuminance(resolvedColor);
  return luminance > 128 ? 'light' : 'dark';
}

export type { CustomTheme };

import { type ThemeType, type ColorsTheme, lightTheme, darkTheme } from './colors.js';
export { type ThemeType, type ColorsTheme, lightTheme, darkTheme };

export const ansiTheme: ColorsTheme = {
  type: 'ansi',
  Background: 'black',
  Foreground: '',
  LightBlue: 'blue',
  AccentBlue: 'blue',
  AccentPurple: 'magenta',
  AccentCyan: 'cyan',
  AccentGreen: 'green',
  AccentYellow: 'yellow',
  AccentRed: 'red',
  DiffAdded: 'green',
  DiffRemoved: 'red',
  Comment: 'gray',
  Gray: 'gray',
  DarkGray: 'gray',
  InputBackground: 'black',
  MessageBackground: 'black',
  FocusBackground: 'black',
};

export class Theme {
  /**
   * The default foreground color for text when no specific highlight rule applies.
   * This is an Ink-compatible color string (hex or name).
   */
  readonly defaultColor: string;
  /**
   * Stores the mapping from highlight.js class names (e.g., 'hljs-keyword')
   * to Ink-compatible color strings (hex or name).
   */
  protected readonly _colorMap: Readonly<Record<string, string>>;
  readonly semanticColors: SemanticColors;

  /**
   * Creates a new Theme instance.
   * @param name The name of the theme.
   * @param rawMappings The raw CSSProperties mappings from a react-syntax-highlighter theme object.
   */
  constructor(
    readonly name: string,
    readonly type: ThemeType,
    rawMappings: Record<string, CSSProperties>,
    readonly colors: ColorsTheme,
    semanticColors?: SemanticColors,
  ) {
    this.semanticColors = semanticColors ?? {
      text: {
        primary: this.colors.Foreground,
        secondary: this.colors.Gray,
        link: this.colors.AccentBlue,
        accent: this.colors.AccentPurple,
        response: this.colors.Foreground,
      },
      background: {
        primary: this.colors.Background,
        message:
          this.colors.MessageBackground ??
          interpolateColor(
            this.colors.Background,
            this.colors.Gray,
            DEFAULT_INPUT_BACKGROUND_OPACITY,
          ),
        input:
          this.colors.InputBackground ??
          interpolateColor(
            this.colors.Background,
            this.colors.Gray,
            DEFAULT_INPUT_BACKGROUND_OPACITY,
          ),
        focus:
          this.colors.FocusBackground ??
          interpolateColor(
            this.colors.Background,
            this.colors.FocusColor ?? this.colors.AccentGreen,
            DEFAULT_SELECTION_OPACITY,
          ),
        diff: {
          added: this.colors.DiffAdded,
          removed: this.colors.DiffRemoved,
        },
      },
      border: {
        default: this.colors.DarkGray,
      },
      ui: {
        comment: this.colors.Gray,
        symbol: this.colors.AccentCyan,
        active: this.colors.AccentBlue,
        dark: this.colors.DarkGray,
        focus: this.colors.FocusColor ?? this.colors.AccentGreen,
        gradient: this.colors.GradientColors,
      },
      status: {
        error: this.colors.AccentRed,
        success: this.colors.AccentGreen,
        warning: this.colors.AccentYellow,
      },
    };
    this._colorMap = Object.freeze(this._buildColorMap(rawMappings)); // Build and freeze the map

    // Determine the default foreground color
    const rawDefaultColor = rawMappings['hljs']?.color;
    this.defaultColor = (rawDefaultColor ? Theme._resolveColor(rawDefaultColor) : undefined) ?? ''; // Default to empty string if not found or resolvable
  }

  /**
   * Gets the Ink-compatible color string for a given highlight.js class name.
   * @param hljsClass The highlight.js class name (e.g., 'hljs-keyword', 'hljs-string').
   * @returns The corresponding Ink color string (hex or name) if it exists.
   */
  getInkColor(hljsClass: string): string | undefined {
    return Reflect.get(this._colorMap, hljsClass) as string | undefined;
  }

  /**
   * Resolves a CSS color value (name or hex) into an Ink-compatible color string.
   * @param colorValue The raw color string (e.g., 'blue', '#ff0000', 'darkkhaki').
   * @returns An Ink-compatible color string (hex or name), or undefined if not resolvable.
   */
  private static _resolveColor(colorValue: string): string | undefined {
    return resolveColor(colorValue);
  }

  /**
   * Builds the internal map from highlight.js class names to Ink-compatible color strings.
   * This method is protected and primarily intended for use by the constructor.
   * @param hljsTheme The raw CSSProperties mappings from a react-syntax-highlighter theme object.
   * @returns An Ink-compatible theme map (Record<string, string>).
   */
  protected _buildColorMap(hljsTheme: Record<string, CSSProperties>): Record<string, string> {
    const inkTheme: Record<string, string> = {};
    for (const key in hljsTheme) {
      // Ensure the key starts with 'hljs-' or is 'hljs' for the base style
      if (!key.startsWith('hljs-') && key !== 'hljs') {
        continue; // Skip keys not related to highlighting classes
      }

      const style = Reflect.get(hljsTheme, key) as CSSProperties | undefined;
      if (style?.color) {
        const resolvedColor = Theme._resolveColor(style.color);
        if (resolvedColor !== undefined) {
          // Use the original key from the hljsTheme (e.g., 'hljs-keyword')
          Reflect.set(inkTheme, key, resolvedColor);
        }
        // If color is not resolvable, it's omitted from the map,
        // this enables falling back to the default foreground color.
      }
      // We currently only care about the 'color' property for Ink rendering.
      // Other properties like background, fontStyle, etc., are ignored.
    }
    return inkTheme;
  }
}

/**
 * Creates a Theme instance from a custom theme configuration.
 * @param customTheme The custom theme configuration.
 * @returns A new Theme instance.
 */
function coalesce(...vals: (string | undefined | null)[]): string {
  for (const v of vals) {
    if (v !== undefined && v !== null) return v;
  }
  return '';
}

function resolveCustomColors(ct: CustomTheme): ColorsTheme {
  const bgPrimary = ct.background?.primary;
  const bgDiffAdded = ct.background?.diff?.added;
  const bgDiffRemoved = ct.background?.diff?.removed;
  const textPrimary = ct.text?.primary;
  const textLink = ct.text?.link;
  const textAccent = ct.text?.accent;
  const textSecondary = ct.text?.secondary;
  const statusSuccess = ct.status?.success;
  const statusWarning = ct.status?.warning;
  const statusError = ct.status?.error;
  const uiComment = ct.ui?.comment;
  const uiFocus = ct.ui?.focus;
  const uiGradient = ct.ui?.gradient;

  const bg = coalesce(bgPrimary, ct.Background);
  const fg = coalesce(textPrimary, ct.Foreground);
  const link = coalesce(textLink, ct.LightBlue);
  const accent = coalesce(textAccent, ct.AccentPurple);
  const success = coalesce(statusSuccess, ct.AccentGreen);
  const warning = coalesce(statusWarning, ct.AccentYellow);
  const error = coalesce(statusError, ct.AccentRed);
  const secondary = coalesce(textSecondary, ct.Gray);
  const darkGray = ct.DarkGray ?? interpolateColor(bg, secondary, DEFAULT_BORDER_OPACITY);
  const inputBg = interpolateColor(bg, secondary, DEFAULT_INPUT_BACKGROUND_OPACITY);
  const focusBg = interpolateColor(bg, success || '#3CA84B', DEFAULT_SELECTION_OPACITY);

  return {
    type: 'custom',
    Background: bg,
    Foreground: fg,
    LightBlue: link,
    AccentBlue: coalesce(textLink, ct.AccentBlue),
    AccentPurple: accent,
    AccentCyan: coalesce(textLink, ct.AccentCyan),
    AccentGreen: success,
    AccentYellow: warning,
    AccentRed: error,
    DiffAdded: coalesce(bgDiffAdded, ct.DiffAdded),
    DiffRemoved: coalesce(bgDiffRemoved, ct.DiffRemoved),
    Comment: coalesce(uiComment, ct.Comment),
    Gray: secondary,
    DarkGray: darkGray,
    InputBackground: inputBg,
    MessageBackground: inputBg,
    FocusBackground: focusBg,
    FocusColor: uiFocus ?? ct.AccentGreen,
    GradientColors: uiGradient ?? ct.GradientColors,
  };
}

function buildHljsMappings(colors: ColorsTheme): Record<string, CSSProperties> {
  return {
    hljs: {
      display: 'block',
      overflowX: 'auto',
      padding: '0.5em',
      background: colors.Background,
      color: colors.Foreground,
    },
    'hljs-keyword': { color: colors.AccentBlue },
    'hljs-literal': { color: colors.AccentBlue },
    'hljs-symbol': { color: colors.AccentBlue },
    'hljs-name': { color: colors.AccentBlue },
    'hljs-link': { color: colors.AccentBlue, textDecoration: 'underline' },
    'hljs-built_in': { color: colors.AccentCyan },
    'hljs-type': { color: colors.AccentCyan },
    'hljs-number': { color: colors.AccentGreen },
    'hljs-class': { color: colors.AccentGreen },
    'hljs-string': { color: colors.AccentYellow },
    'hljs-meta-string': { color: colors.AccentYellow },
    'hljs-regexp': { color: colors.AccentRed },
    'hljs-template-tag': { color: colors.AccentRed },
    'hljs-subst': { color: colors.Foreground },
    'hljs-function': { color: colors.Foreground },
    'hljs-title': { color: colors.Foreground },
    'hljs-params': { color: colors.Foreground },
    'hljs-formula': { color: colors.Foreground },
    'hljs-comment': { color: colors.Comment, fontStyle: 'italic' },
    'hljs-quote': { color: colors.Comment, fontStyle: 'italic' },
    'hljs-doctag': { color: colors.Comment },
    'hljs-meta': { color: colors.Gray },
    'hljs-meta-keyword': { color: colors.Gray },
    'hljs-tag': { color: colors.Gray },
    'hljs-variable': { color: colors.AccentPurple },
    'hljs-template-variable': { color: colors.AccentPurple },
    'hljs-attr': { color: colors.LightBlue },
    'hljs-attribute': { color: colors.LightBlue },
    'hljs-builtin-name': { color: colors.LightBlue },
    'hljs-section': { color: colors.AccentYellow },
    'hljs-emphasis': { fontStyle: 'italic' },
    'hljs-strong': { fontWeight: 'bold' },
    'hljs-bullet': { color: colors.AccentYellow },
    'hljs-selector-tag': { color: colors.AccentYellow },
    'hljs-selector-id': { color: colors.AccentYellow },
    'hljs-selector-class': { color: colors.AccentYellow },
    'hljs-selector-attr': { color: colors.AccentYellow },
    'hljs-selector-pseudo': { color: colors.AccentYellow },
    'hljs-addition': {
      backgroundColor: colors.AccentGreen,
      display: 'inline-block',
      width: '100%',
    },
    'hljs-deletion': {
      backgroundColor: colors.AccentRed,
      display: 'inline-block',
      width: '100%',
    },
  };
}

function buildSemanticColors(ct: CustomTheme, c: ColorsTheme): SemanticColors {
  const textPrimary = ct.text?.primary;
  const textSecondary = ct.text?.secondary;
  const textLink = ct.text?.link;
  const textAccent = ct.text?.accent;
  const textResponse = ct.text?.response;
  const bgPrimary = ct.background?.primary;
  const bgDiffAdded = ct.background?.diff?.added;
  const bgDiffRemoved = ct.background?.diff?.removed;
  const uiComment = ct.ui?.comment;
  const uiSymbol = ct.ui?.symbol;
  const uiActive = ct.ui?.active;
  const uiFocus = ct.ui?.focus;
  const uiGradient = ct.ui?.gradient;
  const statusError = ct.status?.error;
  const statusSuccess = ct.status?.success;
  const statusWarning = ct.status?.warning;

  return {
    text: {
      primary: coalesce(textPrimary, c.Foreground),
      secondary: coalesce(textSecondary, c.Gray),
      link: coalesce(textLink, c.AccentBlue),
      accent: coalesce(textAccent, c.AccentPurple),
      response: coalesce(textResponse, textPrimary, c.Foreground),
    },
    background: {
      primary: coalesce(bgPrimary, c.Background),
      message: c.MessageBackground!,
      input: c.InputBackground!,
      focus: c.FocusBackground!,
      diff: {
        added: coalesce(bgDiffAdded, c.DiffAdded),
        removed: coalesce(bgDiffRemoved, c.DiffRemoved),
      },
    },
    border: { default: c.DarkGray },
    ui: {
      comment: coalesce(uiComment, c.Comment),
      symbol: coalesce(uiSymbol, c.Gray),
      active: coalesce(uiActive, c.AccentBlue),
      dark: c.DarkGray,
      focus: coalesce(uiFocus, c.AccentGreen),
      gradient: uiGradient ?? c.GradientColors,
    },
    status: {
      error: coalesce(statusError, c.AccentRed),
      success: coalesce(statusSuccess, c.AccentGreen),
      warning: coalesce(statusWarning, c.AccentYellow),
    },
  };
}

export function createCustomTheme(customTheme: CustomTheme): Theme {
  const colors = resolveCustomColors(customTheme);
  const rawMappings = buildHljsMappings(colors);
  const semanticColors = buildSemanticColors(customTheme, colors);

  return new Theme(customTheme.name, 'custom', rawMappings, colors, semanticColors);
}

/**
 * Validates a custom theme configuration.
 * @param customTheme The custom theme to validate.
 * @returns An object with isValid boolean and error message if invalid.
 */
export function validateCustomTheme(customTheme: Partial<CustomTheme>): {
  isValid: boolean;
  error?: string;
  warning?: string;
} {
  // Since all fields are optional, we only need to validate the name.
  if (customTheme.name && !isValidThemeName(customTheme.name)) {
    return {
      isValid: false,
      error: `Invalid theme name: ${customTheme.name}`,
    };
  }

  return {
    isValid: true,
  };
}

/**
 * Checks if a theme name is valid.
 * @param name The theme name to validate.
 * @returns True if the theme name is valid.
 */
function isValidThemeName(name: string): boolean {
  // Theme name should be non-empty and not contain invalid characters
  return name.trim().length > 0 && name.trim().length <= 50;
}

/**
 * Picks a default theme name based on terminal background color.
 * It first tries to find a theme with an exact background color match.
 * If no match is found, it falls back to a light or dark theme based on the
 * luminance of the background color.
 * @param terminalBackground The hex color string of the terminal background.
 * @param availableThemes A list of available themes to search through.
 * @param defaultDarkThemeName The name of the fallback dark theme.
 * @param defaultLightThemeName The name of the fallback light theme.
 * @returns The name of the chosen theme.
 */
export function pickDefaultThemeName(
  terminalBackground: string | undefined,
  availableThemes: readonly Theme[],
  defaultDarkThemeName: string,
  defaultLightThemeName: string,
): string {
  if (terminalBackground) {
    const lowerTerminalBackground = terminalBackground.toLowerCase();
    for (const theme of availableThemes) {
      if (!theme.colors.Background) continue;
      // resolveColor can return undefined
      const themeBg = resolveColor(theme.colors.Background)?.toLowerCase();
      if (themeBg === lowerTerminalBackground) {
        return theme.name;
      }
    }
  }

  const themeType = getThemeTypeFromBackgroundColor(terminalBackground);
  if (themeType === 'light') {
    return defaultLightThemeName;
  }

  return defaultDarkThemeName;
}
