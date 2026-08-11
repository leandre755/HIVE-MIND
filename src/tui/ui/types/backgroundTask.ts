export interface AnsiToken {
  text: string;
  color?: string;
  bgColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  dim?: boolean;
}

export type AnsiLine = AnsiToken[];

export type AnsiOutput = AnsiLine[];

export type CompletionBehavior = 'accept' | 'dismiss' | 'next' | 'prev';

export interface BackgroundTask {
  pid: number;
  command: string;
  output: string | AnsiOutput;
  isBinary: boolean;
  binaryBytesReceived: number;
  status: 'running' | 'exited';
  exitCode?: number;
  completionBehavior?: CompletionBehavior;
}
