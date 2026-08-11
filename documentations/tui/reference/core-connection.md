# core/connection.ts and TuiServerTransport — Reference

This document describes the WebSocket-based data bridge between the HIVE-MIND Core (server) and the TUI Client.

## Network Architecture

The communication operates as a local loopback WebSocket server starting on port `5001`. Local loopback connections use the non-TLS WebSocket protocol; remote endpoints must use the TLS WebSocket protocol.

```
┌──────────────────┐               ┌──────────────────┐
│  HIVE-MIND Core  │  loopback:5001 │    TUI Client    │
│ (WebSocket Host) ├──────────────>│ (WebSocket Client)│
└──────────────────┘               └──────────────────┘
```

---

## Jeton d'Authentification

Upon startup, the Core generates a secure, single-session token and stores it in:
`tui-connection.json` (located in the project root).

```json
{
  "host": "localhost",
  "port": 5001,
  "token": "472e3895-cd90-48ee-a044-709de7a00f27"
}
```

The client must parse this file to successfully negotiate connection.

---

## Message Protocol

All messages are JSON payloads containing a `type` string property.

### Client-to-Server Messages (Upstream)

| Message Type            | Properties                                             | Purpose                                                       |
| ----------------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| `auth`                  | `token: string`                                        | Initial client handshake authentication.                      |
| `user_message`          | `text: string`, `options?: object`                     | Submits user input command/prompt to the agent.               |
| `confirmation_response` | `id: string`, `approved: boolean`, `feedback?: string` | Delivers the human decision (HITL) for a safety confirmation. |

#### Client Handshake Example

```json
{
  "type": "auth",
  "token": "472e3895-cd90-48ee-a044-709de7a00f27"
}
```

### Server-to-Client Messages (Downstream)

| Message Type           | Properties           | Purpose                                                           |
| ---------------------- | -------------------- | ----------------------------------------------------------------- |
| `auth_success`         | None                 | Confirms authentication; client is approved.                      |
| `connection_status`    | `connected: boolean` | Broadcasts Core connection status to WhatsApp/External providers. |
| `message`              | `message: object`    | Broadcasts incoming chat/agent responses.                         |
| `presence`             | `presence: object`   | Broadcasts agent states (`thinking`, `paused`, `idle`).           |
| `confirmation_request` | `request: object`    | Triggers a HITL safety prompt popup overlay on the client UI.     |
| `voice`                | `voice: object`      | Streams synthesized audio chunks for TTS output.                  |

---

## APIs and Classes

### TuiServerTransport Class (Server)

Located in [TuiServerTransport.ts](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/core/transport/TuiServerTransport.ts).

```typescript
export class TuiServerTransport {
  async start(): Promise<void>;
  async stop(): Promise<void>;
  broadcast(type: string, payload: any): void;
}
```

### HiveCoreConnection Class (Client)

Located in [connection.ts](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/core/connection.ts).

```typescript
export class HiveCoreConnection {
  async connect(): Promise<void>;
  disconnect(): void;
  sendUserMessage(text: string, options?: any): void;
  sendConfirmationResponse(id: string, approved: boolean, feedback?: string): void;
  onStatusChange(callback: (status: ConnectionStatus) => void): () => void;
  onMessage(callback: (msg: any) => void): () => void;
}
```
