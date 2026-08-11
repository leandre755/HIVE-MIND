import type React from 'react';
import { Box, Text } from 'ink';
import { HistoryItemSubagent } from '../../contexts/UIStateContext.js';

interface SubagentHistoryMessageProps {
  item: HistoryItemSubagent;
  terminalWidth: number;
}

interface SubagentActivity {
  id: string;
  type?: string;
  content?: string;
  status?: string;
}

export const SubagentHistoryMessage: React.FC<SubagentHistoryMessageProps> = ({
  item,
  terminalWidth,
}) => (
  <Box flexDirection="column" width={terminalWidth} marginBottom={1}>
    <Box marginBottom={1}>
      <Text bold color="cyan">
        🤖 {item.agentName} Trace ({(item.history || []).length} items)
      </Text>
    </Box>

    {(item.history || []).map((activity: SubagentActivity) => (
      <Box key={activity.id} marginLeft={2} marginBottom={0}>
        <Text color={activity.type === 'thought' ? 'gray' : 'white'}>
          {activity.type === 'thought' ? '🧠' : '🛠️'} {activity.content}
          {activity.status === 'running' && ' (Running...)'}
          {activity.status === 'completed' && ' ✅'}
          {activity.status === 'error' && ' ❌'}
        </Text>
      </Box>
    ))}
  </Box>
);
