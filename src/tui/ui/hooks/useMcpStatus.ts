import { useEffect, useState } from 'react';
import { HiveConfig } from '../../config/hiveConfig.js';
import { coreEvents, CoreEvent } from '../../utils/coreEvents.js';
import { MCPDiscoveryState } from '../contexts/UIStateContext.js';

interface McpManagerLike {
  getDiscoveryState(): string;
  getMcpServerCount(): number;
}

export function useMcpStatus(config: HiveConfig) {
  const [discoveryState, setDiscoveryState] = useState<string>(
    () =>
      (
        config.getMcpClientManager() as unknown as McpManagerLike | undefined
      )?.getDiscoveryState() ?? MCPDiscoveryState.NOT_STARTED,
  );

  const [mcpServerCount, setMcpServerCount] = useState<number>(
    () =>
      (
        config.getMcpClientManager() as unknown as McpManagerLike | undefined
      )?.getMcpServerCount() ?? 0,
  );

  useEffect(() => {
    const onChange = () => {
      const manager = config.getMcpClientManager() as unknown as McpManagerLike | undefined;
      if (manager) {
        setDiscoveryState(manager.getDiscoveryState());
        setMcpServerCount(manager.getMcpServerCount());
      }
    };

    coreEvents.on(CoreEvent.McpClientUpdate, onChange);
    return () => {
      coreEvents.off(CoreEvent.McpClientUpdate, onChange);
    };
  }, [config]);

  // We are ready if discovery has completed, OR if it hasn't even started and there are no servers.
  const isMcpReady =
    discoveryState === MCPDiscoveryState.COMPLETED ||
    (discoveryState === MCPDiscoveryState.NOT_STARTED && mcpServerCount === 0);

  return {
    discoveryState,
    mcpServerCount,
    isMcpReady,
  };
}
