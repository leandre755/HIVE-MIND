export interface UniversalResponse {
  data?: unknown; // Raw data (JSON)
  markdown: string; // Standard Markdown (Pivot format)
  plainText?: string; // Sanitized text for WhatsApp (concise)
  visual?: unknown; // Rich components (Rich CLI, Discord Embeds)
}

export interface MessageData {
  chatId: string;
  sender: string;
  senderName?: string;
  text: string;
  isGroup: boolean;
  mediaType?: string;
  quotedMsg?: unknown;
  hasImage?: boolean;
  image?: unknown;
  useNativeAudio?: boolean;
  audioBuffer?: Buffer;
  raw?: unknown;
  id?: string;
  sourceChannel?: string; // Origin (whatsapp, cli, etc.)
  systemContext?: string;
}

export interface BotEvent {
  type: 'message' | 'scheduled' | 'proactive' | 'group_event';
  chatId?: string;
  data: MessageData | unknown;
  priority?: number;
  sourceChannel?: string;
}

export interface ContextData {
  systemPrompt: string;
  messages: unknown[];
  refusalPrompt?: string;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ActionRecord {
  id: string;
  task: string;
  status: 'pending' | 'completed' | 'failed';
  step?: number;
  total_steps?: number;
}
