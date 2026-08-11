import type React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import { formatCommand } from '../key/keybindingUtils.js';
import { Command } from '../key/keyBindings.js';

export const RawMarkdownIndicator: React.FC = () => {
  const modKey = formatCommand(Command.TOGGLE_MARKDOWN);
  return (
    <Box>
      <Text>
        raw markdown mode
        <Text color={theme.text.secondary}> ({modKey} to toggle) </Text>
      </Text>
    </Box>
  );
};
