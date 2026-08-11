/**
 * HiveCoreConnection — Pont client WebSocket léger entre la TUI et le Core HIVE-MIND.
 *
 * Se connecte au serveur WebSocket hébergé par le Core en tâche de fond,
 * s'authentifie par token dynamique et relaie les événements.
 */

import { safeReadFileSync } from '../../utils/safeFs.js';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { hiveConfig } from '../config/hiveConfig.js';
import { createWebSocketUrl } from '../ui/utils/urlSecurityUtils.js';
import {
  ToolConfirmationOutcome,
  type AgentProtocol,
  type AgentEvent,
  type AgentContentPart,
  type ToolConfirmationPayload,
  type ToolCallConfirmationDetails,
} from '../ui/contexts/UIStateContext.js';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface ActiveServiceInfo {
  service: string;
  action: string;
  timestamp: number;
}

export class HiveCoreConnection implements AgentProtocol {
  private listeners = new Set<(event: AgentEvent) => void>();
  private statusListeners = new Set<(status: ConnectionStatus) => void>();

  private ws: WebSocket | null = null;
  private status: ConnectionStatus = 'disconnected';
  private reconnectTimer: NodeJS.Timeout | null = null;
  private initialized = false;
  private token = '';
  private port = 5001;
  private host = 'localhost';
  private configPath = join(process.cwd(), 'tui-connection.json');
  private activeServices: ActiveServiceInfo[] = [];

  public getActiveServices(): ActiveServiceInfo[] {
    return this.activeServices;
  }

  public getConnectionStatus(): ConnectionStatus {
    return this.status;
  }

  public onStatusChange(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private setStatus(newStatus: ConnectionStatus): void {
    if (this.status !== newStatus) {
      this.status = newStatus;
      for (const listener of this.statusListeners) {
        try {
          listener(newStatus);
        } catch {
          /* ignore */
        }
      }
      // Diffuser aussi un événement générique
      this.emit({
        type: 'custom',
        name: 'connection_status_change',
        message: newStatus,
      });
    }
  }

  /**
   * Tente de lire le fichier tui-connection.json et d'extraire les paramètres de connexion.
   */
  private loadConnectionConfig(): boolean {
    try {
      const raw = safeReadFileSync(this.configPath, 'utf-8');
      const data = JSON.parse(raw);
      this.host = data.host || 'localhost';
      this.port = data.port || 5001;
      this.token = data.token || '';
      return !!this.token;
    } catch {
      return false;
    }
  }

  /**
   * Démarre la boucle de connexion résiliente.
   */
  async connect(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.setStatus('connecting');
    this.reconnectLoop();
  }

  /**
   * Tente une connexion immédiate et replanifie en cas d'échec.
   */
  private reconnectLoop(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Si la config n'est pas lisible (Core non démarré), on attend et on réessaye
    if (!this.loadConnectionConfig()) {
      this.setStatus('connecting');
      this.reconnectTimer = setTimeout(() => this.reconnectLoop(), 2000);
      return;
    }

    const endpoint = createWebSocketUrl(this.host, this.port);
    console.log('[HiveCoreConnection] Connexion à %s...', endpoint);

    try {
      this.ws = new WebSocket(endpoint);

      this.ws.on('open', () => {
        // Envoyer le token d'authentification en premier message
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(
            JSON.stringify({
              type: 'auth',
              token: this.token,
            }),
          );
        }
      });

      this.ws.on('message', (data) => {
        try {
          const payload = JSON.parse(data.toString());

          if (payload.type === 'auth_success') {
            this.setStatus('connected');
            console.log('[HiveCoreConnection] ✅ Connecté et authentifié auprès du Core.');
            return;
          }

          // Une fois connecté, dispatcher les autres messages
          if (this.status === 'connected') {
            this.handleServerEvent(payload);
          }
        } catch (err: unknown) {
          console.error(
            '[HiveCoreConnection] Erreur parsing message serveur:',
            (err as Error).message,
          );
        }
      });

      this.ws.on('close', () => {
        this.handleDisconnect();
      });

      this.ws.on('error', () => {
        this.handleDisconnect();
      });
    } catch {
      this.handleDisconnect();
    }
  }

  private handleDisconnect(): void {
    if (this.ws) {
      try {
        this.ws.terminate();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.activeServices = [];
    this.setStatus('connecting');

    if (this.reconnectTimer === null) {
      this.reconnectTimer = setTimeout(() => this.reconnectLoop(), 2000);
    }
  }

  private handleCustomEvent(data?: Record<string, unknown>): void {
    if (!data) return;
    const name = data.name as string | undefined;
    const message = data.message as string | undefined;
    if (name === 'service_start' && message) {
      if (!this.activeServices.some((s) => s.service === message)) {
        this.activeServices.push({ service: message, action: 'thinking', timestamp: Date.now() });
      }
    } else if (name === 'service_end' && message) {
      this.activeServices = this.activeServices.filter((s) => s.service !== message);
    }
    if (name) {
      this.emit({
        type: 'custom',
        name,
        message,
      });
    }
  }

  private handleMessageEvent(data?: Record<string, unknown>): void {
    if (!data) return;
    if (data.sender === 'assistant' || data.sender === 'agent' || data.role === 'agent') {
      this.emit({
        type: 'message',
        role: 'agent',
        content: [{ type: 'text', text: String(data.text ?? '') }],
      });
    }
  }

  private handlePresenceEvent(data?: Record<string, unknown>): void {
    if (!data) return;
    if (data.presence === 'composing' || data.presence === 'recording') {
      this.emit({ type: 'agent_start' });
    } else if (data.presence === 'paused' || data.presence === 'available') {
      this.emit({ type: 'agent_end' });
    }
  }

  private resolveConfirmationType(typeStr: string): 'ask_user' | 'info' | 'exec' {
    if (typeStr === 'ask_user') return 'ask_user';
    if (typeStr === 'permission_request') return 'info';
    return 'exec';
  }

  private handleConfirmationRequest(event: Record<string, unknown>): void {
    const eventType = String(event.type ?? '');
    const eventId = String(event.id ?? '');
    const description = String(event.description ?? '');
    const resolvedType = this.resolveConfirmationType(eventType);

    const confirmationDetails = {
      type: resolvedType,
      id: eventId,
      title: 'Security Confirmation',
      command: description,
      prompt: description,
      rootCommand: description,
      rootCommands: [description],
      commands: [description],
      questions:
        eventType === 'ask_user' && event.data && typeof event.data === 'object'
          ? (Reflect.get(event.data as object, 'questions') as Record<string, unknown>[])
          : undefined,
      onConfirm: async (
        outcome: ToolConfirmationOutcome,
        confirmPayload?: ToolConfirmationPayload,
      ) => {
        const approved = outcome !== ToolConfirmationOutcome.Cancel;
        let feedback = confirmPayload?.feedback;
        if (!feedback && confirmPayload) {
          const answers = Reflect.get(confirmPayload as object, 'answers');
          if (answers) {
            feedback = JSON.stringify(answers);
          }
        }

        this.sendPayload({
          type: 'confirmation_response',
          id: eventId,
          approved,
          feedback,
        });

        this.emit({
          type: 'tool_response',
          requestId: eventId,
          name: 'security_confirmation',
          isError: !approved,
          display: {
            result: approved ? 'Approved' : `Rejected: ${feedback || 'No feedback'}`,
          },
        });
      },
    };

    this.emit({
      type: 'tool_request',
      requestId: eventId,
      name: 'security_confirmation',
      display: {
        title: 'Security Confirmation',
        format: 'notice',
      },
      _meta: {
        legacyState: {
          displayName: 'Security Confirmation',
          description,
          status: 'awaiting_approval',
        },
      },
      confirmationDetails: confirmationDetails as unknown as ToolCallConfirmationDetails,
    });
  }

  /**
   * Traite un événement envoyé par le serveur WebSocket.
   */
  private handleServerEvent(payload: { type: string; data: Record<string, unknown> }): void {
    const { type, data } = payload;

    if (type === 'custom') {
      this.handleCustomEvent(data);
      return;
    }

    if (type === 'message') {
      this.handleMessageEvent(data);
      return;
    }

    if (type === 'presence') {
      this.handlePresenceEvent(data);
      return;
    }

    if (type === 'confirmation_request' && data) {
      this.handleConfirmationRequest(data);
      return;
    }

    if (data && typeof data === 'object') {
      const eventToEmit = 'type' in data ? data : { type, ...data };
      this.emit(eventToEmit as unknown as AgentEvent);
    } else if (type === 'agent_start' || type === 'agent_end') {
      this.emit({ type } as AgentEvent);
    }
  }

  /**
   * Ferme la connexion proprement.
   */
  async disconnect(): Promise<void> {
    this.initialized = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close(1000, 'TUI exiting');
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.activeServices = [];
    this.setStatus('disconnected');
  }

  /**
   * Envoie un message utilisateur au Core via le WebSocket.
   */
  async send(request: { message: { content: AgentContentPart[] } }): Promise<{ streamId: string }> {
    const text = request.message.content.map((part) => part.text).join('');
    if (!text.trim()) {
      throw new Error('Cannot send an empty message to the core.');
    }

    if (this.status !== 'connected') {
      throw new Error('Cannot send message: not connected to the HIVE-MIND Core.');
    }

    this.sendPayload({
      type: 'user_message',
      text,
      options: {
        systemContext: hiveConfig.getHiveMdContext(),
      },
    });

    // Simuler un début de traitement immédiat
    this.emit({ type: 'agent_start' });

    return { streamId: `tui-${Date.now()}` };
  }

  /**
   * Abonne un listener aux événements agent.
   */
  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Annule la requête en cours.
   */
  async abort(): Promise<void> {
    this.emit({ type: 'agent_end' });
    return Promise.resolve();
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[HiveCoreConnection] Listener error:', error);
      }
    }
  }

  private sendPayload(payload: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(payload));
      } catch (err: unknown) {
        console.error(
          '[HiveCoreConnection] Erreur envoi payload WebSocket:',
          (err as Error).message,
        );
      }
    }
  }
}

export const hiveCoreConnection = new HiveCoreConnection();
export default hiveCoreConnection;
