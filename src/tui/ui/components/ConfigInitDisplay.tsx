import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { MCPServerStatus, McpClient } from '../contexts/UIStateContext.js';
import { CoreEvent, coreEvents } from '../../utils/coreEvents.js';
import { HiveSpinner } from './HiveSpinner.js';
import { theme } from '../semantic-colors.js';

export const ConfigInitDisplay = ({
  message: initialMessage = 'Working...',
}: {
  message?: string;
}) => {
  const [message, setMessage] = useState(initialMessage);

  useEffect(() => {
    const onChange = (clients?: Map<string, McpClient>) => {
      if (!clients || clients.size === 0) {
        setMessage(initialMessage);
        return;
      }
      let connected = 0;
      const connecting: string[] = [];
      for (const [name, client] of clients.entries()) {
        if (
          (client as unknown as { getStatus: () => MCPServerStatus }).getStatus() ===
          MCPServerStatus.CONNECTED
        ) {
          connected++;
        } else {
          connecting.push(name);
        }
      }

      if (connecting.length > 0) {
        const maxDisplay = 3;
        const displayedServers = connecting.slice(0, maxDisplay).join(', ');
        const remaining = connecting.length - maxDisplay;
        const suffix = remaining > 0 ? `, +${remaining} more` : '';
        const mcpMessage = `Connecting to MCP servers... (${connected}/${clients.size}) - Waiting for: ${displayedServers}${suffix}`;
        setMessage(
          initialMessage && initialMessage !== 'Working...'
            ? `${initialMessage} (${mcpMessage})`
            : mcpMessage,
        );
      } else {
        const mcpMessage = `Connecting to MCP servers... (${connected}/${clients.size})`;
        setMessage(
          initialMessage && initialMessage !== 'Working...'
            ? `${initialMessage} (${mcpMessage})`
            : mcpMessage,
        );
      }
    };

    coreEvents.on(CoreEvent.McpClientUpdate, onChange);
    return () => {
      coreEvents.off(CoreEvent.McpClientUpdate, onChange);
    };
  }, [initialMessage]);

  return (
    <Box marginTop={1}>
      <Text>
        <HiveSpinner /> <Text color={theme.text.primary}>{message}</Text>
      </Text>
    </Box>
  );
};
