/**
 * @license
 * Copyright 2026 HIVE-MIND
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import { HiveConfig } from '../../config/hiveConfig.js';

interface TipsProps {
  config: HiveConfig;
}

export const Tips: React.FC<TipsProps> = ({ config }) => {
  const hiveMdFileCount = config.getHiveMdFileCount();

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.text.primary}>Tips for getting started:</Text>
      {hiveMdFileCount === 0 && (
        <Text color={theme.text.primary}>
          1. Create <Text bold>hive.md</Text> files to customize your interactions
        </Text>
      )}
      <Text color={theme.text.primary}>
        {hiveMdFileCount === 0 ? '2.' : '1.'} <Text color={theme.text.secondary}>/help</Text> for
        more information
      </Text>
      <Text color={theme.text.primary}>
        {hiveMdFileCount === 0 ? '3.' : '2.'} Ask coding questions, edit code or run commands
      </Text>
      <Text color={theme.text.primary}>
        {hiveMdFileCount === 0 ? '4.' : '3.'} Be specific for the best results
      </Text>
    </Box>
  );
};
