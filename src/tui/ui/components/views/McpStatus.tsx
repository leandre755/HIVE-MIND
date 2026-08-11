/**
 * @license
 * Copyright 2025 HIVE-MIND
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  MCPServerStatus,
  MCPServerConfig,
  HistoryItemMcpStatus,
  JsonMcpPrompt,
  JsonMcpResource,
  JsonMcpTool,
} from '../../contexts/UIStateContext.js';
import { Box, Text } from 'ink';
import type React from 'react';
import { MAX_MCP_RESOURCES_TO_SHOW } from '../../constants.js';
import { theme } from '../../semantic-colors.js';

interface McpStatusProps {
  servers: Record<string, MCPServerConfig>;
  tools: JsonMcpTool[];
  prompts: JsonMcpPrompt[];
  resources: JsonMcpResource[];
  blockedServers: Array<{ name: string; extensionName: string }>;
  serverStatus: (serverName: string) => MCPServerStatus;
  authStatus: HistoryItemMcpStatus['authStatus'];
  enablementState: HistoryItemMcpStatus['enablementState'];
  errors: Record<string, string>;
  discoveryInProgress: boolean;
  connectingServers: string[];
  showDescriptions: boolean;
  showSchema: boolean;
}

interface ServerStatusInfo {
  indicator: string;
  text: string;
  color: string;
}

function resolveServerStatus(
  status: MCPServerStatus,
  enablement: HistoryItemMcpStatus['enablementState'][string] | undefined,
): ServerStatusInfo {
  if (enablement && !enablement.enabled) {
    return {
      indicator: '⏸️',
      text: enablement.isSessionDisabled ? 'Disabled (session)' : 'Disabled',
      color: theme.text.secondary,
    };
  }
  switch (status) {
    case MCPServerStatus.CONNECTED:
      return { indicator: '🟢', text: 'Ready', color: theme.status.success };
    case MCPServerStatus.CONNECTING:
      return {
        indicator: '🔄',
        text: 'Starting... (first startup may take longer)',
        color: theme.status.warning,
      };
    default:
      return { indicator: '🔴', text: 'Disconnected', color: theme.status.error };
  }
}

function buildAuthStatusNode(
  authMode: HistoryItemMcpStatus['authStatus'][string],
): React.ReactNode {
  if (authMode === 'authenticated') return <Text> (OAuth)</Text>;
  if (authMode === 'expired') return <Text color={theme.status.error}> (OAuth expired)</Text>;
  if (authMode === 'unauthenticated')
    return <Text color={theme.status.warning}> (OAuth not authenticated)</Text>;
  return null;
}

function buildResourceSummary(
  toolCount: number,
  promptCount: number,
  resourceCount: number,
): string[] {
  const parts: string[] = [];
  if (toolCount > 0) parts.push(`${toolCount} ${toolCount === 1 ? 'tool' : 'tools'}`);
  if (promptCount > 0) parts.push(`${promptCount} ${promptCount === 1 ? 'prompt' : 'prompts'}`);
  if (resourceCount > 0)
    parts.push(`${resourceCount} ${resourceCount === 1 ? 'resource' : 'resources'}`);
  return parts;
}

const ServerRow: React.FC<{
  serverName: string;
  server: MCPServerConfig;
  serverTools: JsonMcpTool[];
  serverPrompts: JsonMcpPrompt[];
  serverResources: JsonMcpResource[];
  statusInfo: ServerStatusInfo;
  resolvedStatus: MCPServerStatus;
  authStatusNode: React.ReactNode;
  error?: string;
  showDescriptions: boolean;
  showSchema: boolean;
}> = ({
  serverName,
  server,
  serverTools,
  serverPrompts,
  serverResources,
  statusInfo,
  resolvedStatus,
  authStatusNode,
  error,
  showDescriptions,
  showSchema,
}) => {
  const displayName = server.extension?.name
    ? `${serverName} (from ${server.extension.name})`
    : serverName;
  const parts = buildResourceSummary(
    serverTools.length,
    serverPrompts.length,
    serverResources.length,
  );
  return (
    <Box key={serverName} flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={statusInfo.color}>{statusInfo.indicator} </Text>
        <Text bold>{displayName}</Text>
        <Text>
          {' - '}
          {statusInfo.text}
          {resolvedStatus === MCPServerStatus.CONNECTED && parts.length > 0
            ? ` (${parts.join(', ')})`
            : ''}
        </Text>
        {authStatusNode}
      </Box>
      {resolvedStatus === MCPServerStatus.CONNECTING && (
        <Text> (tools and prompts will appear when ready)</Text>
      )}
      {resolvedStatus === MCPServerStatus.DISCONNECTED && serverTools.length > 0 && (
        <Text> ({serverTools.length} tools cached)</Text>
      )}
      {error && (
        <Box marginLeft={2}>
          <Text color={theme.status.error}>Error: {error}</Text>
        </Box>
      )}
      {showDescriptions && server?.description && (
        <Text color={theme.text.secondary}>{server.description.trim()}</Text>
      )}
      {serverTools.length > 0 && (
        <Box flexDirection="column" marginLeft={2}>
          <Text color={theme.text.primary}>Tools:</Text>
          {serverTools.map((tool) => (
            <Box key={tool.name} flexDirection="column">
              <Text>
                - <Text color={theme.text.primary}>{tool.name}</Text>
              </Text>
              {showDescriptions && tool.description && (
                <Box marginLeft={2}>
                  <Text color={theme.text.secondary}>{tool.description.trim()}</Text>
                </Box>
              )}
              {showSchema &&
                tool.schema &&
                (tool.schema.parametersJsonSchema || tool.schema.parameters) && (
                  <Box flexDirection="column" marginLeft={4}>
                    <Text color={theme.text.secondary}>Parameters:</Text>
                    <Text color={theme.text.secondary}>
                      {JSON.stringify(
                        tool.schema.parametersJsonSchema ?? tool.schema.parameters,
                        null,
                        2,
                      )}
                    </Text>
                  </Box>
                )}
            </Box>
          ))}
        </Box>
      )}
      {serverPrompts.length > 0 && (
        <Box flexDirection="column" marginLeft={2}>
          <Text color={theme.text.primary}>Prompts:</Text>
          {serverPrompts.map((prompt) => (
            <Box key={prompt.name} flexDirection="column">
              <Text>
                - <Text color={theme.text.primary}>{prompt.name}</Text>
              </Text>
              {showDescriptions && prompt.description && (
                <Box marginLeft={2}>
                  <Text color={theme.text.primary}>{prompt.description.trim()}</Text>
                </Box>
              )}
            </Box>
          ))}
        </Box>
      )}
      {serverResources.length > 0 && (
        <Box flexDirection="column" marginLeft={2}>
          <Text color={theme.text.primary}>Resources:</Text>
          {serverResources.slice(0, MAX_MCP_RESOURCES_TO_SHOW).map((resource, index) => (
            <Box key={`${resource.serverName}-resource-${index}`} flexDirection="column">
              <Text>
                -{' '}
                <Text color={theme.text.primary}>
                  {resource.name || resource.uri || 'resource'}
                </Text>
                {resource.uri ? ` (${resource.uri})` : ''}
                {resource.mimeType ? ` [${resource.mimeType}]` : ''}
              </Text>
              {showDescriptions && resource.description && (
                <Box marginLeft={2}>
                  <Text color={theme.text.secondary}>{resource.description.trim()}</Text>
                </Box>
              )}
            </Box>
          ))}
          {serverResources.length > MAX_MCP_RESOURCES_TO_SHOW && (
            <Text color={theme.text.secondary}>
              {'  '}... {serverResources.length - MAX_MCP_RESOURCES_TO_SHOW}{' '}
              {serverResources.length - MAX_MCP_RESOURCES_TO_SHOW === 1 ? 'resource' : 'resources'}{' '}
              hidden
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
};

export const McpStatus: React.FC<McpStatusProps> = ({
  servers,
  tools,
  prompts,
  resources,
  blockedServers,
  serverStatus,
  authStatus,
  enablementState,
  errors,
  discoveryInProgress,
  connectingServers,
  showDescriptions,
  showSchema,
}) => {
  const serverNames = Object.keys(servers).filter(
    (name) => !blockedServers.some((b) => b.name === name),
  );

  if (serverNames.length === 0 && blockedServers.length === 0) {
    return (
      <Box flexDirection="column">
        <Text>No MCP servers configured.</Text>
        <Text>
          Please view documentation in your browser:{' '}
          <Text color={theme.text.link}>https://github.com/leandre755/HIVE-MIND</Text> or use the
          /help command
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {discoveryInProgress && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.status.warning}>
            ⏳ MCP servers are starting up ({connectingServers.length} initializing)...
          </Text>
          <Text color={theme.text.primary}>
            Note: First startup may take longer. Tool availability will update automatically.
          </Text>
        </Box>
      )}
      <Text bold>Configured MCP servers:</Text>
      <Box height={1} />
      {serverNames.map((serverName) => {
        const server = Reflect.get(servers, serverName) as MCPServerConfig;
        const serverTools = tools.filter((t) => t.serverName === serverName);
        const serverPrompts = prompts.filter((p) => p.serverName === serverName);
        const serverResources = resources.filter((r) => r.serverName === serverName);
        const rawStatus = serverStatus(serverName);
        const hasCached =
          serverTools.length > 0 || serverPrompts.length > 0 || serverResources.length > 0;
        const resolvedStatus =
          rawStatus === MCPServerStatus.DISCONNECTED && hasCached
            ? MCPServerStatus.CONNECTED
            : rawStatus;
        const enablement = Reflect.get(enablementState, serverName);
        const statusInfo = resolveServerStatus(resolvedStatus, enablement);
        const currentAuthStatus = Reflect.get(
          authStatus,
          serverName,
        ) as HistoryItemMcpStatus['authStatus'][string];
        const currentError = Reflect.get(errors, serverName)
          ? String(Reflect.get(errors, serverName))
          : undefined;
        return (
          <ServerRow
            key={serverName}
            serverName={serverName}
            server={server}
            serverTools={serverTools}
            serverPrompts={serverPrompts}
            serverResources={serverResources}
            statusInfo={statusInfo}
            resolvedStatus={resolvedStatus}
            authStatusNode={buildAuthStatusNode(currentAuthStatus)}
            error={currentError}
            showDescriptions={showDescriptions}
            showSchema={showSchema}
          />
        );
      })}
      {blockedServers.map((server) => (
        <Box key={server.name} marginBottom={1}>
          <Text color={theme.status.error}>🔴 </Text>
          <Text bold>
            {server.name}
            {server.extensionName ? ` (from ${server.extensionName})` : ''}
          </Text>
          <Text> - Blocked</Text>
        </Box>
      ))}
    </Box>
  );
};
