# How to Customize Color Themes in the TUI

This guide explains how to edit and add custom color themes for the HIVE-MIND TUI.

## Prerequisites

- Access to the HIVE-MIND codebase.
- A basic understanding of HSL/RGB color spaces.
- Dev server running (`npm run tui`).

## Steps

### 1. View the color tokens configuration

Open [colors.ts](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/colors.ts).

This file exposes the base color tokens used across the application. Verify the structure of the `colors` object and check if you need to add custom neon hexadecimal codes.

### 2. Map colors to Semantic Roles

Open [semantic-colors.ts](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/semantic-colors.ts).

This file maps base color tokens to UI-specific roles like `background`, `border`, `text.primary`, `accent.magenta`, etc.

To change the primary highlight color of the application, locate the `theme` object definition:

```typescript
export const theme = {
  text: {
    primary: '#FFFFFF',
    secondary: '#888888',
    highlight: '#FF00FF', // Change this to modify highlights
  },
  border: {
    default: '#800080',
    active: '#FF00FF',
  },
};
```

Update the hex values with your desired colors.

### 3. Add a theme in the ThemeDialog registry

Open [ThemeDialog.constants.ts](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/components/ThemeDialog.constants.ts) (or [ThemeDialog.tsx](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/components/ThemeDialog.tsx) directly).

To register a new theme that users can select interactively:

1. Locate the `THEMES` array.
2. Insert your new theme object definition:

```typescript
{
    id: 'cyberpunk-gold',
    name: 'Cyberpunk Gold',
    colors: {
        primary: '#FFD700',
        secondary: '#FFA500',
        background: '#0B0B00',
        border: '#8B6508'
    }
}
```

### 4. Wire the theme choice in AppContainer

Open [AppContainer.tsx](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/AppContainer.tsx).

Ensure your theme configuration is read by checking the `useTerminalTheme` call:

```typescript
const { currentTheme, setTheme } = useTerminalTheme();
```

Your theme will now automatically apply colors dynamically through the React contexts.

## Verify the modifications

1. Open the TUI: `npm run tui`
2. Press `/settings` or access the theme dialog.
3. Switch themes and verify that the border colors and text highlights change instantly.
