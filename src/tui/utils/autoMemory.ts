import { debugLogger } from './errors.js';
import { HiveConfig } from '../config/hiveConfig.js';
import { startMemoryService } from '../ui/contexts/UIStateContext.js';

export function startAutoMemoryIfEnabled(config: HiveConfig): void {
  if (!config.isAutoMemoryEnabled()) {
    return;
  }

  startMemoryService(config).catch((e) => {
    debugLogger.error('Failed to start memory service:', e);
  });
}
