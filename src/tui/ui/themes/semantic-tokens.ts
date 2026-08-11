import { lightTheme, darkTheme } from './colors.js';

import type { SemanticColors } from './types.js';
export type { SemanticColors };

export const lightSemanticColors: SemanticColors = {
  text: {
    primary: lightTheme.Foreground,
    secondary: lightTheme.Gray,
    link: lightTheme.AccentBlue,
    accent: lightTheme.AccentPurple,
    response: lightTheme.Foreground,
  },
  background: {
    primary: lightTheme.Background,
    message: lightTheme.MessageBackground!,
    input: lightTheme.InputBackground!,
    focus: lightTheme.FocusBackground!,
    diff: {
      added: lightTheme.DiffAdded,
      removed: lightTheme.DiffRemoved,
    },
  },
  border: {
    default: lightTheme.DarkGray,
  },
  ui: {
    comment: lightTheme.Comment,
    symbol: lightTheme.Gray,
    active: lightTheme.AccentBlue,
    dark: lightTheme.DarkGray,
    focus: lightTheme.AccentGreen,
    gradient: lightTheme.GradientColors,
  },
  status: {
    error: lightTheme.AccentRed,
    success: lightTheme.AccentGreen,
    warning: lightTheme.AccentYellow,
  },
};

export const darkSemanticColors: SemanticColors = {
  text: {
    primary: darkTheme.Foreground,
    secondary: darkTheme.Gray,
    link: darkTheme.AccentBlue,
    accent: darkTheme.AccentPurple,
    response: darkTheme.Foreground,
  },
  background: {
    primary: darkTheme.Background,
    message: darkTheme.MessageBackground!,
    input: darkTheme.InputBackground!,
    focus: darkTheme.FocusBackground!,
    diff: {
      added: darkTheme.DiffAdded,
      removed: darkTheme.DiffRemoved,
    },
  },
  border: {
    default: darkTheme.DarkGray,
  },
  ui: {
    comment: darkTheme.Comment,
    symbol: darkTheme.Gray,
    active: darkTheme.AccentBlue,
    dark: darkTheme.DarkGray,
    focus: darkTheme.AccentGreen,
    gradient: darkTheme.GradientColors,
  },
  status: {
    error: darkTheme.AccentRed,
    success: darkTheme.AccentGreen,
    warning: darkTheme.AccentYellow,
  },
};
