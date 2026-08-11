import { impersonatedRequest } from '../../utils/TlsImpersonator.js';

const CLEARCUT_URL = 'https://play.googleapis.com/log?format=json&hasfast=true';

const METADATA_KEYS = {
  GEMINI_CLI_SURFACE: 39,
  GEMINI_CLI_VERSION: 54,
  GEMINI_CLI_GIT_COMMIT_HASH: 55,
  GEMINI_CLI_OS: 82,
  GEMINI_CLI_SESSION_ID: 40,
  GEMINI_CLI_PROMPT_ID: 35,
  GEMINI_CLI_AUTH_TYPE: 36,
};

interface LogMetadataEntry {
  gemini_cli_key: number;
  value: string;
}

interface LogEvent {
  console_type: string;
  application: number;
  event_name: string;
  event_metadata: LogMetadataEntry[][];
  client_install_id?: string;
}

interface ClearcutRequestEntry {
  event_time_ms: number;
  source_extension_json: string;
}

interface ClearcutPayload {
  log_source_name: string;
  request_time_ms: number;
  log_event: ClearcutRequestEntry[];
}

export class ClearcutSimulator {
  private static installId = '7f9c8d2a-4b6e-4c8d-9a1b-3f2a5b6c7d8e';
  private static sessionId = `session-${Date.now()}`;
  private static version = '0.41.2';
  private static commitHash = '0da6569b6';

  /**
   * Envoie de faux événements d'analytics Clearcut à Google avec notre agent d'imitation TLS.
   */
  private static async sendEvents(events: LogEvent[]): Promise<boolean> {
    try {
      const logEntries: ClearcutRequestEntry[] = events.map((event) => ({
        event_time_ms: Date.now(),
        source_extension_json: JSON.stringify(event),
      }));

      const payload: ClearcutPayload[] = [
        {
          log_source_name: 'CONCORD',
          request_time_ms: Date.now(),
          log_event: logEntries,
        },
      ];

      const res = await impersonatedRequest(CLEARCUT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Antigravity/1.18.3',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        console.warn(`[Clearcut Simulator] Google Clearcut upload rejected: ${res.status}`);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('[Clearcut Simulator] Failed to push clearcut analytics:', err);
      return false;
    }
  }

  /**
   * Construit les métadonnées de base identiques à l'IDE officiel.
   */
  private static buildBaseMetadata(extra: LogMetadataEntry[] = []): LogMetadataEntry[][] {
    const metadata: LogMetadataEntry[] = [
      { gemini_cli_key: METADATA_KEYS.GEMINI_CLI_SURFACE, value: 'antigravity' },
      { gemini_cli_key: METADATA_KEYS.GEMINI_CLI_VERSION, value: this.version },
      { gemini_cli_key: METADATA_KEYS.GEMINI_CLI_GIT_COMMIT_HASH, value: this.commitHash },
      { gemini_cli_key: METADATA_KEYS.GEMINI_CLI_OS, value: process.platform },
      { gemini_cli_key: METADATA_KEYS.GEMINI_CLI_SESSION_ID, value: this.sessionId },
      ...extra,
    ];
    return [metadata];
  }

  /**
   * Simule un événement "start_session"
   */
  public static async trackStartSession(): Promise<boolean> {
    const event: LogEvent = {
      console_type: 'GEMINI_CLI',
      application: 102,
      event_name: 'start_session',
      event_metadata: this.buildBaseMetadata([
        { gemini_cli_key: METADATA_KEYS.GEMINI_CLI_AUTH_TYPE, value: 'oauth' },
      ]),
      client_install_id: this.installId,
    };
    return this.sendEvents([event]);
  }

  /**
   * Simule un événement "new_prompt" lors de l'envoi d'une question
   */
  public static async trackNewPrompt(promptId: string): Promise<boolean> {
    const event: LogEvent = {
      console_type: 'GEMINI_CLI',
      application: 102,
      event_name: 'new_prompt',
      event_metadata: this.buildBaseMetadata([
        { gemini_cli_key: METADATA_KEYS.GEMINI_CLI_PROMPT_ID, value: promptId },
      ]),
      client_install_id: this.installId,
    };
    return this.sendEvents([event]);
  }

  /**
   * Simule un événement "tool_call" lors de l'exécution d'un outil
   */
  public static async trackToolCall(_toolName: string, _success: boolean): Promise<boolean> {
    const event: LogEvent = {
      console_type: 'GEMINI_CLI',
      application: 102,
      event_name: 'tool_call',
      event_metadata: this.buildBaseMetadata(),
      client_install_id: this.installId,
    };
    return this.sendEvents([event]);
  }
}
