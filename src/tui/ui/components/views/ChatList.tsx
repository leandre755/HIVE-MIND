import type React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../semantic-colors.js';
import { ChatDetail } from '../../contexts/UIStateContext.js';

interface ChatListProps {
  chats: readonly ChatDetail[];
}

export const ChatList: React.FC<ChatListProps> = ({ chats }) => {
  if (chats.length === 0) {
    return <Text>No saved conversation checkpoints found.</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text>List of saved conversations:</Text>
      <Box height={1} />
      {chats.map((chat) => {
        const isoString = chat.mtime ?? '';
        const match = isoString.match(/(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
        const formattedDate = match ? `${match[1]} ${match[2]}` : 'Invalid Date';
        const displayName = chat.name ?? chat.title ?? chat.id ?? 'Unknown';
        return (
          <Box key={displayName} flexDirection="row">
            <Text>
              {'  '}- <Text color={theme.text.accent}>{displayName}</Text>{' '}
              <Text color={theme.text.secondary}>({formattedDate})</Text>
            </Text>
          </Box>
        );
      })}
      <Box height={1} />
      <Text color={theme.text.secondary}>Note: Newest last, oldest first</Text>
    </Box>
  );
};
