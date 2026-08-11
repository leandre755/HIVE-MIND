import React, { useMemo } from 'react';
import { TodoList, useUIState, HistoryItemToolGroup } from '../../contexts/UIStateContext.js';
import { Checklist } from '../Checklist.js';
import type { ChecklistItemData } from '../ChecklistItem.js';
import { formatCommand } from '../../key/keybindingUtils.js';
import { Command } from '../../key/keyBindings.js';

export const TodoTray: React.FC = () => {
  const uiState = useUIState();

  const todos: TodoList | null = useMemo(() => {
    // Find the most recent action-item list written by tools that output an action-item list (e.g., WriteTodosTool or Tracker tools)
    for (let i = uiState.history.length - 1; i >= 0; i--) {
      const entry = uiState.history.at(i);
      if (!entry || entry.type !== 'tool_group') {
        continue;
      }
      const toolGroup = entry as HistoryItemToolGroup;
      for (const tool of toolGroup.tools) {
        if (
          typeof tool.resultDisplay !== 'object' ||
          !tool.resultDisplay ||
          !('todos' in tool.resultDisplay)
        ) {
          continue;
        }
        return tool.resultDisplay as unknown as TodoList;
      }
    }
    return null;
  }, [uiState.history]);

  const checklistItems: ChecklistItemData[] = useMemo(() => {
    if (!todos || !todos.todos) {
      return [];
    }
    return todos.todos.map((todo) => ({
      status: todo.status as ChecklistItemData['status'],
      label: todo.description,
    }));
  }, [todos]);

  if (!todos || !todos.todos) {
    return null;
  }

  return (
    <Checklist
      title="Todo"
      items={checklistItems}
      isExpanded={uiState.showFullTodos}
      toggleHint={`${formatCommand(Command.SHOW_FULL_TODOS)} to toggle`}
    />
  );
};
