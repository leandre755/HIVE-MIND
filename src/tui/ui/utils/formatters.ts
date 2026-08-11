import * as path from 'path';
import { homedir } from 'os';

export interface ThoughtSummary {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  durationMs?: number;
  thoughts?: string;
  subject?: string;
}

export function tildeifyPath(filePath: string): string {
  if (!filePath) return '';
  const home = homedir();
  if (filePath.startsWith(home)) {
    return filePath.replace(home, '~');
  }
  return filePath;
}

export function shortenPath(filePath: string, maxLength: number = 30): string {
  if (!filePath) return '';
  if (filePath.length <= maxLength) return filePath;
  const parts = filePath.split(path.sep);
  if (parts.length <= 2) {
    return filePath.substring(filePath.length - maxLength);
  }
  const filename = parts.pop() || '';
  const firstPart = parts[0] || '';
  const remainingLength = maxLength - firstPart.length - filename.length - 4; // 4 for ".../"
  if (remainingLength <= 0) {
    return `...${path.sep}${filename}`;
  }
  // Take as many directories as possible from the end
  let currentPath = '';
  while (parts.length > 0) {
    const nextPart = parts.pop() || '';
    if (currentPath.length + nextPart.length + 1 > remainingLength) {
      break;
    }
    currentPath = nextPart + (currentPath ? path.sep + currentPath : '');
  }
  return `${firstPart}${path.sep}...${path.sep}${currentPath}${path.sep}${filename}`;
}

export function displayContentToString(display: unknown): string | undefined {
  if (!display) return undefined;
  if (typeof display === 'string') return display;
  const obj = display as { text?: string };
  if (typeof obj.text === 'string') return obj.text;
  return JSON.stringify(display);
}

export function parseThought(thought: string | undefined): ThoughtSummary {
  return {
    id: `thought-${Date.now()}`,
    title: 'Thought',
    status: 'completed',
    thoughts: thought || '',
  };
}

export function partListUnionToString(parts: unknown): string {
  if (!parts) return '';
  if (typeof parts === 'string') return parts;
  if (Array.isArray(parts)) {
    return parts.map((p: unknown) => (p as { text?: string })?.text || '').join('');
  }
  return (parts as { text?: string })?.text || '';
}

export function formatRelativeTime(timestamp: number | string | undefined): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return String(timestamp);
  return date.toLocaleDateString();
}

export function escapeShellArg(arg: string, shellType: string = 'bash'): string {
  if (shellType === 'cmd' || shellType === 'powershell') {
    return `"${arg.replace(/"/g, '""')}"`;
  }
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

export function getShellConfiguration(): { shell: string } {
  return { shell: process.platform === 'win32' ? 'powershell' : 'bash' };
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export function formatResetTime(resetTime: string, _mode?: string): string {
  const date = new Date(resetTime);
  if (isNaN(date.getTime())) return resetTime;
  const now = Date.now();
  const diff = date.getTime() - now;
  if (diff <= 0) return 'now';
  return formatDuration(diff);
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const unit = (Reflect.get(units, i) as string | undefined) || 'B';
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${unit}`;
}

export function formatTimeAgo(timestamp: number | string): string {
  const date = new Date(timestamp);
  const now = Date.now();
  const diff = now - date.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}
