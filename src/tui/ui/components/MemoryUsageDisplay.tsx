import React, { useEffect, useState } from 'react';
import { Text, Box } from 'ink';
import { theme } from '../semantic-colors.js';
import process from 'node:process';
import { formatBytes } from '../utils/formatters.js';

export const MemoryUsageDisplay: React.FC<{
  color?: string;
  isActive?: boolean;
}> = ({ color = theme.text.primary, isActive = true }) => {
  const [memoryUsage, setMemoryUsage] = useState<string>('');
  const [memoryUsageColor, setMemoryUsageColor] = useState<string>(color);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const updateMemory = () => {
      const usage = process.memoryUsage().rss;
      setMemoryUsage(formatBytes(usage));
      setMemoryUsageColor(usage >= 2 * 1024 * 1024 * 1024 ? theme.status.error : color);
    };

    const intervalId = setInterval(updateMemory, 2000);
    updateMemory(); // Initial update
    return () => clearInterval(intervalId);
  }, [color, isActive]);

  return (
    <Box>
      <Text color={memoryUsageColor}>{memoryUsage}</Text>
    </Box>
  );
};
