/**
 * @license
 * Copyright 2026 HIVE-MIND
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import { HiveConfig } from '../../config/hiveConfig.js';

interface UserIdentityProps {
  config: HiveConfig;
}

export const UserIdentity: React.FC<UserIdentityProps> = () => {
  const ownerName = useMemo(() => {
    return process.env.HIVE_ADMIN_USER || process.env.USER || 'Mathieu';
  }, []);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.text.primary} wrap="truncate-end">
          <Text bold color={theme.text.accent}>
            {ownerName}
          </Text>
          <Text color={theme.text.secondary}> : Owner</Text>
        </Text>
      </Box>
    </Box>
  );
};
