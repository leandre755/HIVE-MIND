# How to Add a Custom Slash Command to the TUI

This guide shows how to register and handle a new slash command in the HIVE-MIND TUI. In this example, you will create a `/ping` command that responds with `pong`.

## Prerequisites

- Access to the HIVE-MIND codebase.
- Basic understanding of TypeScript and React.
- A running development environment (both Core and TUI client).

## Steps

### 1. Register the command definition

Open [useSlashCompletion.ts](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/hooks/useSlashCompletion.ts).

Find the list of registered slash commands (typically defined in a list of items or structures). Append the new `/ping` command object to the list:

```typescript
{
    command: '/ping',
    description: 'Vérifie la latence de connexion avec le Core',
    category: 'system'
}
```

This makes the command appear in the `/` autocomplete suggestions list.

### 2. Implement the command processing logic

Open [slashCommandProcessor.ts](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/hooks/slashCommandProcessor.ts).

Find the handler function, locate the `switch` statement analyzing the input text or command, and add a case for `/ping`:

```typescript
case '/ping': {
    addConsoleMessage({
        type: 'info',
        text: '🏓 Pong! La connexion WebSocket est active.',
        timestamp: new Date()
    });
    return true; // Indique que la commande a été traitée avec succès
}
```

_Note: You can use the `addConsoleMessage` service injecté par le contexte pour écrire directement dans la zone de logs._

### 3. (Optional) Request data from the Core

If your command requires data from the HIVE-MIND Core, use `hiveCoreConnection` to send a message.

Update your handler case to submit a custom client action:

```typescript
case '/ping': {
    hiveCoreConnection.sendUserMessage('ping-action-to-core', { silent: true });
    return true;
}
```

Ensure the Core has a listener registered for this event inside `TuiServerTransport.ts` or `TransportManager.ts`.

## Verify the installation

1. Start your local Core: `ACTIVE_TRANSPORTS=ink-cli npm run start`
2. Start the TUI client: `npm run tui`
3. Type `/pi` in the input bar. Verify that `/ping` appears in the autocomplete popup list.
4. Press `Enter`. Verify that the message `🏓 Pong! La connexion WebSocket est active.` is printed in the logs panel.
