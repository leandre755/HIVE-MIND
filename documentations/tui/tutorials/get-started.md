# Learn to Launch and Use the HIVE-MIND TUI

In this tutorial, you will launch both the HIVE-MIND Core and its interactive Text User Interface (TUI). At the end, you will have a terminal-based control panel running locally, connected to the agent core, and ready to receive commands.

## Prerequisites

- Node.js version 22 or later installed.
- Access to a terminal on your local system.
- An `.env` file configured in the project root with the necessary database and API credentials.

## Step 1 — Navigate to the project directory

Open your terminal and change your working directory to the HIVE-MIND project folder:

```bash
cd Code/HIVE-MIND-RAILWAY
```

## Step 2 — Start the HIVE-MIND Core

The TUI works on a client-server architecture. You must first start the Core (the server) in one-way mode, enabling the WebSocket communication bridge by setting the `ACTIVE_TRANSPORTS` variable to `ink-cli`.

In your first terminal, run:

```bash
ACTIVE_TRANSPORTS=ink-cli npm run start
```

You should see startup logs, followed by:
`[TuiServerTransport] 📄 Configuration écrite`
`[TuiServerTransport] 🚀 Serveur WebSocket démarré sur ws://localhost:5001`

Keep this terminal running.

## Step 3 — Start the client TUI

Open a second terminal window. Navigate to the same project directory:

```bash
cd Code/HIVE-MIND-RAILWAY
```

Run the TUI client runner:

```bash
npm run tui
```

The terminal screen will clear and show a loading sequence, then immediately transition to the HIVE-MIND dashboard with its neon-colored interface.

## Step 4 — Send your first command

In the input bar at the bottom of the TUI client window:

1. Type `/help` and press `Enter`.
2. Look at the command area; a list of available slash commands will print.
3. Press `Esc` or click `Exit` to close.

## What you built

You successfully launched the HIVE-MIND Core, initialized its secure local WebSocket gateway, and connected the terminal-native React-Ink client interface.

## Next steps

- [Add a custom slash command](file:///home/omni/Code/HIVE-MIND-RAILWAY/documentations/tui/howto/add-slash-command.md) to the interface.
- Explore the [technical architecture explanation](file:///home/omni/Code/HIVE-MIND-RAILWAY/documentations/tui/explanation/websocket-architecture.md) of the WebSocket transport layer.
