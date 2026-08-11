import type React from 'react';
import { Text, Box } from 'ink';
import { theme } from '../../semantic-colors.js';
import { getDisplayString } from '../../contexts/UIStateContext.js';

interface ModelMessageProps {
  model: string;
}

export const ModelMessage: React.FC<ModelMessageProps> = ({ model }) => (
  <Box marginLeft={2}>
    <Text color={theme.ui.comment} italic>
      Responding with {getDisplayString(model)}
    </Text>
  </Box>
);
