import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { fork, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WebSocket } from 'ws';
import {
  safeExistsSync,
  safeReadFileSync,
  safeMkdtempSync,
  safeRemoveDirectorySync,
  safeWriteFileSync,
} from '../../utils/safeFs.js';
import { TuiServerTransport } from '../../core/transport/TuiServerTransport.js';
import { hiveTransport } from '../../core/transport/tui/HiveTransport.js';

interface IpcStatusPayload {
  type: 'STATUS_CHANGE';
  status: string;
}

interface IpcEventPayload {
  type: 'EVENT';
  event: {
    type: string;
    role?: string;
    content?: Array<{ type: string; text: string }>;
    name?: string;
    message?: string;
    requestId?: string;
    display?: unknown;
    visual?: unknown;
    [key: string]: unknown;
  };
}

interface IpcSendResultPayload {
  type: 'SEND_RESULT';
  streamId: string;
}

interface IpcSendErrorPayload {
  type: 'SEND_ERROR';
  error: string;
}

interface IpcServicesResultPayload {
  type: 'SERVICES_RESULT';
  services: Array<{ service: string; action: string; timestamp: number }>;
}

type IpcIncomingMessage =
  | { type: 'PROCESS_READY' }
  | { type: 'DISCONNECTED' }
  | IpcStatusPayload
  | IpcEventPayload
  | IpcSendResultPayload
  | IpcSendErrorPayload
  | IpcServicesResultPayload
  | { type: 'ERROR'; error: string };

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

class StandaloneTuiProcessController {
  private child: ChildProcess | null = null;
  public status = 'disconnected';
  public isDisconnectedAcknowledged = false;
  public events: Array<IpcEventPayload['event']> = [];
  private readyResolver: (() => void) | null = null;
  private disconnectResolver: (() => void) | null = null;
  private sendResolver: ((res: { streamId: string }) => void) | null = null;
  private sendRejecter: ((err: Error) => void) | null = null;
  private servicesResolver:
    | ((services: Array<{ service: string; action: string; timestamp: number }>) => void)
    | null = null;

  async start(extraEnv: Record<string, string> = {}): Promise<void> {
    const tuiProjectDir = join(process.cwd(), '../HIVE-MIND-TUI');
    const runnerScript = join(tuiProjectDir, 'src/tests/crossProcessTuiClient.ts');

    const readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolver = resolve;
      setTimeout(() => reject(new Error('Timeout waiting for TUI client process ready')), 5000);
    });

    this.child = fork(runnerScript, [], {
      cwd: tuiProjectDir,
      execArgv: ['--import', 'tsx'],
      env: {
        ...process.env,
        ...extraEnv,
      },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    this.setupChildListeners();
    await readyPromise;
  }

  private setupChildListeners(): void {
    if (!this.child) return;

    this.child.on('message', (msg: IpcIncomingMessage) => {
      this.handleIpcMessage(msg);
    });

    this.child.on('error', (err) => {
      console.error('[TuiProcessController] Erreur sous-processus TUI:', errorMessage(err));
    });
  }

  private handleIpcMessage(msg: IpcIncomingMessage): void {
    if (msg.type === 'PROCESS_READY' && this.readyResolver) {
      this.readyResolver();
      this.readyResolver = null;
      return;
    }

    if (msg.type === 'STATUS_CHANGE') {
      this.status = msg.status;
      return;
    }

    if (msg.type === 'DISCONNECTED') {
      this.isDisconnectedAcknowledged = true;
      if (this.disconnectResolver) {
        this.disconnectResolver();
        this.disconnectResolver = null;
      }
      return;
    }

    if (msg.type === 'EVENT') {
      this.events.push(msg.event);
      return;
    }

    if (msg.type === 'SEND_RESULT' && this.sendResolver) {
      this.sendResolver({ streamId: msg.streamId });
      this.sendResolver = null;
      this.sendRejecter = null;
      return;
    }

    if (msg.type === 'SEND_ERROR' && this.sendRejecter) {
      this.sendRejecter(new Error(msg.error));
      this.sendResolver = null;
      this.sendRejecter = null;
      return;
    }

    if (msg.type === 'SERVICES_RESULT' && this.servicesResolver) {
      this.servicesResolver(msg.services);
      this.servicesResolver = null;
    }
  }

  async connect(): Promise<void> {
    if (!this.child) throw new Error('Client process not started');
    this.child.send({ type: 'CONNECT' });
    await this.waitForStatus('connected', 4000);
  }

  async disconnect(): Promise<void> {
    if (this.child) {
      const disconnectPromise = new Promise<void>((resolve, reject) => {
        this.disconnectResolver = resolve;
        setTimeout(() => reject(new Error('Timeout waiting for disconnect acknowledgement')), 3000);
      });
      this.child.send({ type: 'DISCONNECT' });
      await disconnectPromise;
    }
  }

  async sendUserMessage(text: string): Promise<{ streamId: string }> {
    if (!this.child) throw new Error('Client process not started');

    return new Promise<{ streamId: string }>((resolve, reject) => {
      this.sendResolver = resolve;
      this.sendRejecter = reject;
      this.child?.send({ type: 'SEND', text });
    });
  }

  confirm(requestId: string, approved: boolean, feedback?: string): void {
    if (!this.child) throw new Error('Client process not started');
    this.child.send({ type: 'CONFIRM', requestId, approved, feedback });
  }

  async getActiveServices(): Promise<Array<{ service: string; action: string; timestamp: number }>> {
    if (!this.child) return [];

    return new Promise((resolve) => {
      this.servicesResolver = resolve;
      this.child?.send({ type: 'GET_SERVICES' });
    });
  }

  async waitForStatus(targetStatus: string, timeoutMs = 4000): Promise<void> {
    const start = Date.now();
    let iteration = 0;
    const maxIterations = Math.ceil(timeoutMs / 25) + 10;

    while (iteration < maxIterations && Date.now() - start < timeoutMs) {
      iteration++;
      if (this.status === targetStatus) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(
      `Timeout waiting for status "${targetStatus}" (current: "${this.status}") after ${timeoutMs}ms`,
    );
  }

  async waitForEvent(
    predicate: (evt: IpcEventPayload['event']) => boolean,
    timeoutMs = 4000,
  ): Promise<IpcEventPayload['event']> {
    const start = Date.now();
    let iteration = 0;
    const maxIterations = Math.ceil(timeoutMs / 25) + 10;

    while (iteration < maxIterations && Date.now() - start < timeoutMs) {
      iteration++;
      const match = this.events.find(predicate);
      if (match) return match;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timeout waiting for matching event after ${timeoutMs}ms`);
  }

  async stop(): Promise<void> {
    if (this.child) {
      try {
        this.child.send({ type: 'EXIT' });
      } catch {
        /* ignore */
      }
      try {
        this.child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      this.child = null;
    }
    this.events = [];
  }
}

describe('Cross-Process E2E (Part 1): Discovery, Auth & Event Streaming', () => {
  let server: TuiServerTransport;
  let tuiController: StandaloneTuiProcessController;
  let originalEnv: NodeJS.ProcessEnv;
  let tempDir: string;
  const defaultConnectionPath = join(process.cwd(), 'tui-connection.json');

  beforeEach(() => {
    originalEnv = { ...process.env };
    tempDir = safeMkdtempSync(join(tmpdir(), 'hive-e2e-'));
    server = new TuiServerTransport();
    tuiController = new StandaloneTuiProcessController();
  });

  afterEach(async () => {
    process.env = originalEnv;

    try {
      await tuiController.stop();
    } catch {
      /* ignore */
    }

    try {
      await server.stop();
    } catch {
      /* ignore */
    }

    try {
      safeRemoveDirectorySync(tempDir);
    } catch {
      /* ignore */
    }
  });

  describe('1. Live Discovery, Handshake & Authentication', () => {
    it('starts HIVE-MIND daemon, writes dynamic tui-connection.json, and connects Standalone TUI via handshake', async () => {
      // 1. Démarrer le daemon Core HIVE-MIND
      await server.start();

      expect(safeExistsSync(defaultConnectionPath)).toBe(true);

      const rawConfig = safeReadFileSync(defaultConnectionPath, 'utf-8');
      const config = JSON.parse(rawConfig) as { host: string; port: number; token: string };

      expect(config.host).toBe('localhost');
      expect(typeof config.port).toBe('number');
      expect(config.port).toBeGreaterThanOrEqual(5001);
      expect(typeof config.token).toBe('string');
      expect(config.token.length).toBeGreaterThan(10);

      // 2. Démarrer le sous-processus Standalone TUI et connecter
      await tuiController.start();
      await tuiController.connect();

      expect(tuiController.status).toBe('connected');
    });

    it('rejects unauthorized connection with invalid token and maintains daemon integrity', async () => {
      await server.start();
      const rawConfig = safeReadFileSync(defaultConnectionPath, 'utf-8');
      const config = JSON.parse(rawConfig) as { port: number };

      const unauthClient = new WebSocket(`ws://127.0.0.1:${config.port}`);
      const closeEventPromise = new Promise<{ code: number; reason: string }>((resolve) => {
        unauthClient.on('close', (code, reason) => {
          resolve({ code, reason: reason.toString() });
        });
      });

      unauthClient.on('open', () => {
        unauthClient.send(
          JSON.stringify({
            type: 'auth',
            token: 'UNAUTHORIZED_FORGED_TOKEN_0000',
          }),
        );
      });

      const closeEvent = await closeEventPromise;
      expect(closeEvent.code).toBe(4403);
      expect(closeEvent.reason).toContain('Invalid token');
    });
  });

  describe('2. Live Bidirectional Event Streaming (Daemon → Standalone TUI)', () => {
    beforeEach(async () => {
      await server.start();
      await tuiController.start();
      await tuiController.connect();
    });

    it('daemon emits "presence" event (composing) -> TUI receives agent_start', async () => {
      const waitPromise = tuiController.waitForEvent((e) => e.type === 'agent_start', 3000);

      hiveTransport.emit('presence', { chatId: 'tui-local', presence: 'composing' });

      const startEvent = await waitPromise;
      expect(startEvent).toBeDefined();
      expect(startEvent.type).toBe('agent_start');
    });

    it('daemon emits "presence" event (available) -> TUI receives agent_end', async () => {
      const waitPromise = tuiController.waitForEvent((e) => e.type === 'agent_end', 3000);

      hiveTransport.emit('presence', { chatId: 'tui-local', presence: 'available' });

      const endEvent = await waitPromise;
      expect(endEvent).toBeDefined();
      expect(endEvent.type).toBe('agent_end');
    });

    it('daemon emits "message" event -> TUI receives agent message with text content', async () => {
      const waitPromise = tuiController.waitForEvent((e) => e.type === 'message', 3000);

      hiveTransport.emit('message', {
        chatId: 'tui-local',
        sender: 'assistant',
        text: 'E2E Live streaming response from HIVE-MIND Core daemon',
        isGroup: false,
        sourceChannel: 'ink-cli',
      });

      const msgEvent = await waitPromise;
      expect(msgEvent).toBeDefined();
      expect(msgEvent.role).toBe('agent');
      expect(msgEvent.content).toEqual([
        {
          type: 'text',
          text: 'E2E Live streaming response from HIVE-MIND Core daemon',
        },
      ]);
    });

    it('daemon emits custom/visual_response and connection_status events -> TUI receives all of them', async () => {
      // 1. Événement custom interne émis lors de la transition vers 'connected'
      const customEvent = await tuiController.waitForEvent(
        (e) => e.type === 'custom' && e.name === 'connection_status_change' && e.message === 'connected',
        3000,
      );
      expect(customEvent).toBeDefined();
      expect(customEvent.message).toBe('connected');

      // 2. Événement visual_response émis par le daemon
      const visualWaitPromise = tuiController.waitForEvent(
        (e) => e.type === 'visual_response',
        3000,
      );

      hiveTransport.emit('visual_response', {
        chatId: 'tui-local',
        visual: { chartType: 'network_topology', nodes: 4 },
      });

      const visualEvent = await visualWaitPromise;
      expect(visualEvent).toBeDefined();
      expect(visualEvent.visual).toEqual({ chartType: 'network_topology', nodes: 4 });
    });
  });
});

describe('Cross-Process E2E (Part 2): Message Dispatch, HITL & Lifecycle', () => {
  let server: TuiServerTransport;
  let tuiController: StandaloneTuiProcessController;
  let originalEnv: NodeJS.ProcessEnv;
  let tempDir: string;
  const defaultConnectionPath = join(process.cwd(), 'tui-connection.json');

  beforeEach(() => {
    originalEnv = { ...process.env };
    tempDir = safeMkdtempSync(join(tmpdir(), 'hive-e2e-'));
    server = new TuiServerTransport();
    tuiController = new StandaloneTuiProcessController();
  });

  afterEach(async () => {
    process.env = originalEnv;

    try {
      await tuiController.stop();
    } catch {
      /* ignore */
    }

    try {
      await server.stop();
    } catch {
      /* ignore */
    }

    try {
      safeRemoveDirectorySync(tempDir);
    } catch {
      /* ignore */
    }
  });

  describe('3. User Message Dispatch (Standalone TUI → Daemon)', () => {
    beforeEach(async () => {
      await server.start();
      await tuiController.start();
      await tuiController.connect();
    });

    it('TUI sends user message -> Daemon TuiServerTransport and hiveTransport receive and process the message', async () => {
      let receivedUserMessage: { text: string; sender: string; senderName?: string } | null = null;

      hiveTransport.onMessage((msg) => {
        receivedUserMessage = {
          text: msg.text,
          sender: msg.sender,
          senderName: msg.senderName,
        };
      });

      const sendResult = await tuiController.sendUserMessage('Ping from Standalone TUI');

      expect(sendResult).toBeDefined();
      expect(sendResult.streamId).toMatch(/^tui-\d+$/);

      const start = Date.now();
      while (!receivedUserMessage && Date.now() - start < 3000) {
        await new Promise((r) => setTimeout(r, 25));
      }

      expect(receivedUserMessage).toEqual({
        text: 'Ping from Standalone TUI',
        sender: 'owner@local',
        senderName: 'TUI Admin',
      });
    });

    it('TUI rejects sending empty message with descriptive Error', async () => {
      await expect(tuiController.sendUserMessage('    ')).rejects.toThrow(
        'Cannot send an empty message to the core.',
      );
    });
  });

  describe('4. Human-In-The-Loop (HITL) Security Confirmation Flow', () => {
    beforeEach(async () => {
      await server.start();
      await tuiController.start();
      await tuiController.connect();
    });

    it('daemon requests HITL confirmation -> TUI receives confirmation request -> TUI approves -> Daemon resolves promise', async () => {
      const waitRequestPromise = tuiController.waitForEvent((e) => e.type === 'tool_request', 3000);

      // Lancement de la requête de confirmation côté Daemon
      const confirmationPromise = hiveTransport.requestConfirmation(
        'permission_request',
        { action: 'read_secret_keys', target: '.env' },
        'Authorize access to secret environment variables',
      );

      const toolRequest = await waitRequestPromise;
      expect(toolRequest).toBeDefined();
      expect(toolRequest.name).toBe('security_confirmation');
      expect(toolRequest.requestId).toBeDefined();

      // La TUI approuve la requête de confirmation
      tuiController.confirm(
        toolRequest.requestId!,
        true,
        'Approved by Administrator in E2E test',
      );

      // Le Daemon reçoit la confirmation et résout la promesse
      const confirmationResult = await confirmationPromise;

      expect(confirmationResult).toBeDefined();
      expect(confirmationResult.approved).toBe(true);
      expect(confirmationResult.feedback).toBe('Approved by Administrator in E2E test');
    });

    it('daemon requests HITL confirmation -> TUI rejects/cancels -> Daemon resolves promise as rejected', async () => {
      const waitRequestPromise = tuiController.waitForEvent((e) => e.type === 'tool_request', 3000);

      const confirmationPromise = hiveTransport.requestConfirmation(
        'exec',
        { command: 'rm -rf /tmp/test' },
        'Dangerous command execution confirmation',
      );

      const toolRequest = await waitRequestPromise;
      expect(toolRequest).toBeDefined();
      expect(toolRequest.requestId).toBeDefined();

      // La TUI annule / refuse l'action
      tuiController.confirm(toolRequest.requestId!, false, 'Forbidden execution');

      const confirmationResult = await confirmationPromise;

      expect(confirmationResult).toBeDefined();
      expect(confirmationResult.approved).toBe(false);
      expect(confirmationResult.feedback).toBe('Forbidden execution');
    });
  });

  describe('5. Graceful Lifecycle & Multi-Path Resolution', () => {
    it('resolves custom HIVE_CONNECTION_PATH, completes workflow, and performs clean shutdown', async () => {
      const customConfigPath = join(tempDir, 'custom-tui-connection.json');
      safeWriteFileSync(
        customConfigPath,
        JSON.stringify({
          host: '127.0.0.1',
          port: 5001,
          token: 'custom-path-token-12345',
        }),
        'utf-8',
      );

      await server.start();
      // Mettre à jour le fichier custom avec le port réel lié par le serveur
      const serverConfig = JSON.parse(safeReadFileSync(defaultConnectionPath, 'utf-8')) as {
        port: number;
        token: string;
      };
      safeWriteFileSync(
        customConfigPath,
        JSON.stringify({
          host: '127.0.0.1',
          port: serverConfig.port,
          token: serverConfig.token,
        }),
        'utf-8',
      );

      await tuiController.start({ HIVE_CONNECTION_PATH: customConfigPath });
      await tuiController.connect();

      expect(tuiController.status).toBe('connected');

      // Arrêt propre du client
      await tuiController.disconnect();
      expect(tuiController.isDisconnectedAcknowledged).toBe(true);

      await tuiController.stop();

      // Arrêt propre du serveur
      await server.stop();
      expect(safeExistsSync(defaultConnectionPath)).toBe(false);
    });
  });
});
