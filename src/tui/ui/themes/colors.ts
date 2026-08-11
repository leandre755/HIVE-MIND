export type ThemeType = 'light' | 'dark' | 'ansi' | 'custom';

export interface ColorsTheme {
  type: ThemeType;
  Background: string;
  Foreground: string;
  LightBlue: string;
  AccentBlue: string;
  AccentPurple: string;
  AccentCyan: string;
  AccentGreen: string;
  AccentYellow: string;
  AccentRed: string;
  DiffAdded: string;
  DiffRemoved: string;
  Comment: string;
  Gray: string;
  DarkGray: string;
  InputBackground?: string;
  MessageBackground?: string;
  FocusBackground?: string;
  FocusColor?: string;
  GradientColors?: string[];
}

export const lightTheme: ColorsTheme = {
  type: 'light',
  Background: '#FFFFFF',
  Foreground: '#000000',
  LightBlue: '#005FAF',
  AccentBlue: '#005FAF',
  AccentPurple: '#5F00FF',
  AccentCyan: '#005F87',
  AccentGreen: '#005F00',
  AccentYellow: '#875F00',
  AccentRed: '#AF0000',
  DiffAdded: '#D7FFD7',
  DiffRemoved: '#FFD7D7',
  Comment: '#008700',
  Gray: '#5F5F5F',
  DarkGray: '#5F5F5F',
  InputBackground: '#E4E4E4',
  MessageBackground: '#FAFAFA',
  FocusBackground: '#D7FFD7',
  GradientColors: ['#8A2BE2', '#DA70D6', '#00FFFF'],
};

export const darkTheme: ColorsTheme = {
  type: 'dark',
  Background: '#000000',
  Foreground: '#FFFFFF',
  LightBlue: '#AFD7D7',
  AccentBlue: '#87AFFF',
  AccentPurple: '#D7AFFF',
  AccentCyan: '#87D7D7',
  AccentGreen: '#D7FFD7',
  AccentYellow: '#FFFFAF',
  AccentRed: '#FF87AF',
  DiffAdded: '#005F00',
  DiffRemoved: '#5F0000',
  Comment: '#AFAFAF',
  Gray: '#AFAFAF',
  DarkGray: '#878787',
  InputBackground: '#5F5F5F',
  MessageBackground: '#1C1C1C',
  FocusBackground: '#005F00',
  GradientColors: ['#8A2BE2', '#DA70D6', '#00FFFF'],
};
