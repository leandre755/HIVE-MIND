import type React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import { ApprovalMode } from '../contexts/UIStateContext.js';
import { formatCommand } from '../key/keybindingUtils.js';
import { Command } from '../key/keyBindings.js';

interface ApprovalModeIndicatorProps {
  approvalMode: ApprovalMode;
  allowPlanMode?: boolean;
}

export const ApprovalModeIndicator: React.FC<ApprovalModeIndicatorProps> = ({
  approvalMode,
  allowPlanMode: _allowPlanMode,
}) => {
  let textColor = '';
  let textContent = '';
  let subText = '';

  const cycleHint = formatCommand(Command.CYCLE_APPROVAL_MODE);

  switch (approvalMode) {
    case ApprovalMode.SEMI:
      textColor = theme.status.warning;
      textContent = 'semi-autonomous';
      subText = `${cycleHint} to manual`;
      break;
    case ApprovalMode.NEVER:
      textColor = theme.status.error;
      textContent = 'autonomous';
      subText = `${cycleHint} to manual`;
      break;
    case ApprovalMode.ALWAYS:
    default:
      textColor = theme.text.accent;
      textContent = 'manual';
      subText = `${cycleHint} to semi`;
      break;
  }

  return (
    <Box>
      <Text color={textColor}>
        {textContent ? textContent : null}
        {subText ? (
          <Text color={theme.text.secondary}>
            {textContent ? ' ' : ''}
            {subText}
          </Text>
        ) : null}
      </Text>
    </Box>
  );
};
