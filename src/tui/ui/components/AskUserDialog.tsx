import React, { useReducer, useEffect, useCallback, useMemo, useRef, useContext } from 'react';
import { Box, Text, type DOMElement } from 'ink';
import { useMouseClick } from '../hooks/useMouseClick.js';
import { theme } from '../semantic-colors.js';
import { Question, UIStateContext } from '../contexts/UIStateContext.js';
import { checkExhaustive } from '../../utils/errors.js';
import { BaseSelectionList } from './shared/BaseSelectionList.js';
import type { SelectionListItem } from '../hooks/useSelectionList.js';
import { TabHeader, type Tab } from './shared/TabHeader.js';
import { useKeypress, type Key } from '../hooks/useKeypress.js';
import { Command } from '../key/keyMatchers.js';
import { TextInput } from './shared/TextInput.js';
import { formatCommand } from '../key/keybindingUtils.js';
import { useTextBuffer, expandPastePlaceholders } from './shared/text-buffer.js';
import { getCachedStringWidth } from '../utils/textUtils.js';
import { useTabbedNavigation } from '../hooks/useTabbedNavigation.js';
import { DialogFooter } from './shared/DialogFooter.js';
import { MarkdownDisplay } from '../utils/MarkdownDisplay.js';
import { RenderInline } from '../utils/InlineMarkdownRenderer.js';
import { MaxSizedBox } from './shared/MaxSizedBox.js';
import { useAlternateBuffer } from '../hooks/useAlternateBuffer.js';
import { useKeyMatchers } from '../hooks/useKeyMatchers.js';

/** Padding for dialog content to prevent text from touching edges. */
const DIALOG_PADDING = 4;

/**
 * Checks if text is a single line without markdown identifiers.
 */
function isPlainSingleLine(text: string): boolean {
  // Must be a single line (no newlines)
  if (text.includes('\n') || text.includes('\r')) {
    return false;
  }

  if (text.includes('[') && text.includes('](') && text.includes(')')) {
    return false;
  }

  // Check for common markdown identifiers
  const markdownPatterns = [
    /^#{1,6}\s/, // Headers
    /^[`~]{3,}/, // Code fences
    /^[-*+]\s/, // Unordered lists
    /^\d+\.\s/, // Ordered lists
    /^[-*_]{3,}$/, // Horizontal rules
    /\|/, // Tables
    /\*\*|__/, // Bold
    /(?<!\*)\*(?!\*)/, // Italic (single asterisk not part of bold)
    /(?<!_)_(?!_)/, // Italic (single underscore not part of bold)
    /`[^`]+`/, // Inline code
    /!\[/, // Images
  ];

  for (const pattern of markdownPatterns) {
    if (pattern.test(text)) {
      return false;
    }
  }

  return true;
}

/**
 * Auto-bolds plain single-line text by wrapping in **.
 * Returns the text unchanged if it already contains markdown.
 */
function autoBoldIfPlain(text: string): string {
  if (isPlainSingleLine(text)) {
    return `**${text}**`;
  }
  return text;
}

const ClickableCheckbox: React.FC<{
  isChecked: boolean;
  onClick: () => void;
}> = ({ isChecked, onClick }) => {
  const ref = useRef<DOMElement>(null);
  useMouseClick(ref, () => {
    onClick();
  });

  return (
    <Box ref={ref}>
      <Text color={isChecked ? theme.status.success : theme.text.secondary}>
        [{isChecked ? 'x' : ' '}]
      </Text>
    </Box>
  );
};

interface AskUserDialogState {
  answers: { [key: string]: string };
  isEditingCustomOption: boolean;
  submitted: boolean;
}

type AskUserDialogAction =
  | {
      type: 'SET_ANSWER';
      payload: {
        index: number;
        answer: string;
        submit?: boolean;
      };
    }
  | { type: 'SET_EDITING_CUSTOM'; payload: { isEditing: boolean } }
  | { type: 'SUBMIT' };

const initialState: AskUserDialogState = {
  answers: {},
  isEditingCustomOption: false,
  submitted: false,
};

function askUserDialogReducerLogic(
  state: AskUserDialogState,
  action: AskUserDialogAction,
): AskUserDialogState {
  if (state.submitted) {
    return state;
  }

  switch (action.type) {
    case 'SET_ANSWER': {
      const { index, answer, submit } = action.payload;
      const hasAnswer = answer !== undefined && answer !== null && answer.trim() !== '';
      const newAnswers = { ...state.answers };

      if (hasAnswer) {
        Reflect.set(newAnswers, String(index), answer);
      } else {
        Reflect.deleteProperty(newAnswers, String(index));
      }

      return {
        ...state,
        answers: newAnswers,
        submitted: submit ? true : state.submitted,
      };
    }
    case 'SET_EDITING_CUSTOM': {
      if (state.isEditingCustomOption === action.payload.isEditing) {
        return state;
      }
      return {
        ...state,
        isEditingCustomOption: action.payload.isEditing,
      };
    }
    case 'SUBMIT': {
      return {
        ...state,
        submitted: true,
      };
    }
    default:
      checkExhaustive(action);
      return state;
  }
}

/**
 * Props for the AskUserDialog component.
 */
interface AskUserDialogProps {
  /**
   * The list of questions to ask the user.
   */
  questions: Question[];
  /**
   * Callback fired when the user submits their answers.
   * Returns a map of question index to answer string.
   */
  onSubmit: (answers: { [questionIndex: string]: string }) => void;
  /**
   * Callback fired when the user cancels the dialog (e.g. via Escape).
   */
  onCancel: () => void;
  /**
   * Optional callback to notify parent when text input is active.
   * Useful for managing global keypress handlers.
   */
  onActiveTextInputChange?: (active: boolean) => void;
  /**
   * Width of the dialog.
   */
  width: number;
  /**
   * Height constraint for scrollable content.
   */
  availableHeight?: number;
  /**
   * Custom keyboard shortcut hints (e.g., ["Ctrl+P to edit"])
   */
  extraParts?: string[];
}

interface ReviewViewProps {
  questions: Question[];
  answers: { [key: string]: string };
  onSubmit: () => void;
  progressHeader?: React.ReactNode;
  extraParts?: string[];
}

const ReviewView: React.FC<ReviewViewProps> = ({
  questions,
  answers,
  onSubmit,
  progressHeader,
  extraParts,
}) => {
  const keyMatchers = useKeyMatchers();
  const unansweredCount = questions.length - Object.keys(answers).length;
  const hasUnanswered = unansweredCount > 0;

  // Handle Enter to submit
  useKeypress(
    (key: Key) => {
      if (keyMatchers[Command.RETURN](key)) {
        onSubmit();
        return true;
      }
      return false;
    },
    { isActive: true },
  );

  return (
    <Box flexDirection="column">
      {progressHeader}
      <Box marginBottom={1}>
        <Text bold color={theme.text.primary}>
          Review your answers:
        </Text>
      </Box>

      {hasUnanswered && (
        <Box marginBottom={1}>
          <Text color={theme.status.warning}>
            ⚠ You have {unansweredCount} unanswered question
            {unansweredCount > 1 ? 's' : ''}
          </Text>
        </Box>
      )}

      <Box flexDirection="column">
        {questions.map((q, i) => {
          const ans = (Reflect.get(answers, String(i)) as string | undefined) || '';
          return (
            <Box key={i} marginBottom={0}>
              <Text color={theme.text.secondary}>{q.header}</Text>
              <Text color={theme.text.secondary}> → </Text>
              <Text color={ans ? theme.text.primary : theme.status.warning}>
                {ans || '(not answered)'}
              </Text>
            </Box>
          );
        })}
      </Box>
      <DialogFooter
        primaryAction="Enter to submit"
        navigationActions={`${formatCommand(Command.DIALOG_NEXT)}/${formatCommand(Command.DIALOG_PREV)} to edit answers`}
        extraParts={extraParts}
      />
    </Box>
  );
};

// ============== Text Question View ==============

interface TextQuestionViewProps {
  question: Question;
  onAnswer: (answer: string) => void;
  onSelectionChange?: (answer: string) => void;
  onEditingCustomOption?: (editing: boolean) => void;
  availableWidth: number;
  availableHeight?: number;
  initialAnswer?: string;
  progressHeader?: React.ReactNode;
  keyboardHints?: React.ReactNode;
}

const TextQuestionView: React.FC<TextQuestionViewProps> = ({
  question,
  onAnswer,
  onSelectionChange,
  onEditingCustomOption,
  availableWidth,
  availableHeight,
  initialAnswer,
  progressHeader,
  keyboardHints,
}) => {
  const keyMatchers = useKeyMatchers();
  const isAlternateBuffer = useAlternateBuffer();
  const prefix = '> ';
  const horizontalPadding = 1; // 1 for cursor
  const bufferWidth = availableWidth - getCachedStringWidth(prefix) - horizontalPadding;

  const buffer = useTextBuffer({
    initialText: initialAnswer,
    viewport: { width: Math.max(1, bufferWidth), height: 3 },
    singleLine: false,
  });

  const { text: textValue } = buffer;

  // Sync state change with parent - only when it actually changes
  const lastTextValueRef = useRef(textValue);
  useEffect(() => {
    if (textValue !== lastTextValueRef.current) {
      onSelectionChange?.(expandPastePlaceholders(textValue, buffer.pastedContent));
      lastTextValueRef.current = textValue;
    }
  }, [textValue, onSelectionChange, buffer.pastedContent]);

  // Handle Ctrl+C to clear all text
  const handleExtraKeys = useCallback(
    (key: Key) => {
      if (keyMatchers[Command.QUIT](key)) {
        if (textValue === '') {
          return false;
        }
        buffer.setText('');
        return true;
      }
      return false;
    },
    [buffer, textValue, keyMatchers],
  );

  useKeypress(handleExtraKeys, { isActive: true, priority: true });

  const handleSubmit = useCallback(
    (val: string) => {
      onAnswer(val.trim());
    },
    [onAnswer],
  );

  // Notify parent that we're in text input mode (for Ctrl+C handling)
  useEffect(() => {
    onEditingCustomOption?.(true);
    return () => {
      onEditingCustomOption?.(false);
    };
  }, [onEditingCustomOption]);

  const placeholder = question.placeholder || 'Enter your response';

  const HEADER_HEIGHT = progressHeader ? 2 : 0;
  const INPUT_HEIGHT = 2; // TextInput + margin
  const FOOTER_HEIGHT = 2; // DialogFooter + margin
  const overhead = HEADER_HEIGHT + INPUT_HEIGHT + FOOTER_HEIGHT;
  const questionHeight =
    availableHeight && !isAlternateBuffer ? Math.max(1, availableHeight - overhead) : undefined;

  return (
    <Box flexDirection="column">
      {progressHeader}
      <Box marginBottom={1}>
        <MaxSizedBox
          maxHeight={questionHeight}
          maxWidth={availableWidth}
          overflowDirection="bottom"
        >
          <MarkdownDisplay
            text={autoBoldIfPlain(question.question ?? '')}
            terminalWidth={availableWidth - DIALOG_PADDING}
            isPending={false}
          />
        </MaxSizedBox>
      </Box>

      <Box flexDirection="row" marginBottom={1}>
        <Text color={theme.status.success}>{'> '}</Text>
        <TextInput buffer={buffer} placeholder={placeholder} onSubmit={handleSubmit} />
      </Box>

      {keyboardHints}
    </Box>
  );
};

// ============== Choice Question View ==============

interface OptionItem {
  key: string;
  label: string;
  description: string;
  type: 'option' | 'other' | 'done' | 'all';
  index: number;
}

interface ChoiceQuestionState {
  selectedIndices: Set<number>;
  isCustomOptionSelected: boolean;
  isCustomOptionFocused: boolean;
}

type ChoiceQuestionAction =
  | { type: 'TOGGLE_INDEX'; payload: { index: number; multiSelect: boolean } }
  | { type: 'TOGGLE_ALL'; payload: { totalOptions: number } }
  | {
      type: 'SET_CUSTOM_SELECTED';
      payload: { selected: boolean; multiSelect: boolean };
    }
  | { type: 'TOGGLE_CUSTOM_SELECTED'; payload: { multiSelect: boolean } }
  | { type: 'SET_CUSTOM_FOCUSED'; payload: { focused: boolean } };

function handleToggleAll(state: ChoiceQuestionState, totalOptions: number): ChoiceQuestionState {
  const allSelected = state.selectedIndices.size === totalOptions;
  if (allSelected) {
    return { ...state, selectedIndices: new Set() };
  }
  const newIndices = new Set<number>();
  for (let i = 0; i < totalOptions; i++) {
    newIndices.add(i);
  }
  return { ...state, selectedIndices: newIndices };
}

function handleToggleIndex(
  state: ChoiceQuestionState,
  index: number,
  multiSelect: boolean,
): ChoiceQuestionState {
  const newIndices = new Set(multiSelect ? state.selectedIndices : []);
  if (newIndices.has(index)) {
    newIndices.delete(index);
  } else {
    newIndices.add(index);
  }
  return {
    ...state,
    selectedIndices: newIndices,
    isCustomOptionSelected: multiSelect ? state.isCustomOptionSelected : false,
  };
}

function choiceQuestionReducer(
  state: ChoiceQuestionState,
  action: ChoiceQuestionAction,
): ChoiceQuestionState {
  switch (action.type) {
    case 'TOGGLE_ALL':
      return handleToggleAll(state, action.payload.totalOptions);
    case 'TOGGLE_INDEX':
      return handleToggleIndex(state, action.payload.index, action.payload.multiSelect);
    case 'SET_CUSTOM_SELECTED': {
      const { selected, multiSelect } = action.payload;
      return {
        ...state,
        isCustomOptionSelected: selected,
        selectedIndices: multiSelect ? state.selectedIndices : new Set(),
      };
    }
    case 'TOGGLE_CUSTOM_SELECTED': {
      const { multiSelect } = action.payload;
      if (!multiSelect) return state;

      return {
        ...state,
        isCustomOptionSelected: !state.isCustomOptionSelected,
      };
    }
    case 'SET_CUSTOM_FOCUSED': {
      return {
        ...state,
        isCustomOptionFocused: action.payload.focused,
      };
    }
    default:
      checkExhaustive(action);
      return state;
  }
}

interface ChoiceQuestionViewProps {
  question: Question;
  onAnswer: (answer: string) => void;
  onSelectionChange?: (answer: string) => void;
  onEditingCustomOption?: (editing: boolean) => void;
  availableWidth: number;
  availableHeight?: number;
  initialAnswer?: string;
  progressHeader?: React.ReactNode;
  keyboardHints?: React.ReactNode;
}

function computeChoiceLayout(
  _question: Question,
  selectionItems: Array<SelectionListItem<OptionItem>>,
  progressHeader: React.ReactNode,
  availableHeight: number | undefined,
  isAlternateBuffer: boolean,
) {
  const HEADER_HEIGHT = progressHeader ? 2 : 0;
  const TITLE_MARGIN = 1;
  const FOOTER_HEIGHT = 2;
  const overhead = HEADER_HEIGHT + TITLE_MARGIN + FOOTER_HEIGHT;

  const listHeight = availableHeight ? Math.max(1, availableHeight - overhead) : undefined;

  let questionHeightLimit: number | undefined;
  if (listHeight && !isAlternateBuffer) {
    questionHeightLimit = Math.max(1, listHeight - selectionItems.length * 2);
  }

  const maxItemsToShow =
    listHeight && (!isAlternateBuffer || availableHeight !== undefined)
      ? Math.min(
          selectionItems.length,
          Math.max(1, Math.floor((listHeight - (questionHeightLimit ?? 0)) / 2)),
        )
      : selectionItems.length;

  return { TITLE_MARGIN, questionHeightLimit, maxItemsToShow };
}

function renderChoiceItem(
  optionItem: OptionItem,
  context: { isSelected: boolean; titleColor: string },
  state: {
    selectedIndices: Set<number>;
    isCustomOptionSelected: boolean;
    questionOptions: Array<{ label: string; description: string }>;
    question: Question;
    customBuffer: ReturnType<typeof useTextBuffer>;
    buildAnswerString: (indices: Set<number>, includeCustom: boolean, custom: string) => string;
    onAnswer: (answer: string) => void;
  },
): React.ReactNode {
  const {
    selectedIndices,
    isCustomOptionSelected,
    questionOptions,
    question,
    customBuffer,
    buildAnswerString,
    onAnswer,
  } = state;

  const isChecked =
    (optionItem.type === 'option' && selectedIndices.has(optionItem.index)) ||
    (optionItem.type === 'other' && isCustomOptionSelected) ||
    (optionItem.type === 'all' && selectedIndices.size === questionOptions.length);
  const showCheck =
    question.multiSelect &&
    (optionItem.type === 'option' || optionItem.type === 'other' || optionItem.type === 'all');

  if (optionItem.type === 'other') {
    const placeholder = question.placeholder || 'Enter a custom value';
    return (
      <Box flexDirection="row">
        {showCheck && (
          <ClickableCheckbox
            isChecked={isChecked}
            onClick={() => {
              if (!context.isSelected) {
                // handleSelect would be called externally
              }
            }}
          />
        )}
        <Text color={theme.text.primary}> </Text>
        <TextInput
          buffer={customBuffer}
          placeholder={placeholder}
          focus={context.isSelected}
          onSubmit={(val) => {
            if (question.multiSelect) {
              const fullAnswer = buildAnswerString(selectedIndices, true, val);
              if (fullAnswer) onAnswer(fullAnswer);
            } else if (val.trim()) {
              onAnswer(val.trim());
            }
          }}
        />
        {isChecked && !question.multiSelect && !context.isSelected && (
          <Text color={theme.status.success}> ✓</Text>
        )}
      </Box>
    );
  }

  let labelColor = theme.text.primary;
  if (isChecked && !question.multiSelect) {
    labelColor = theme.status.success;
  } else if (context.isSelected) {
    labelColor = context.titleColor;
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        {showCheck && (
          <ClickableCheckbox
            isChecked={isChecked}
            onClick={() => {
              if (!context.isSelected) {
                // handleSelect would be called externally
              }
            }}
          />
        )}
        <Text color={labelColor} bold={optionItem.type === 'done'}>
          {' '}
          {optionItem.label}
        </Text>
        {isChecked && !question.multiSelect && <Text color={theme.status.success}> ✓</Text>}
      </Box>
      {optionItem.description && (
        <Box paddingLeft={showCheck ? 4 : 1}>
          <Text color={theme.text.secondary} wrap="wrap">
            <RenderInline text={optionItem.description} defaultColor={theme.text.secondary} />
          </Text>
        </Box>
      )}
    </Box>
  );
}

function buildChoiceSelectionItems(
  questionOptions: Array<{ label: string; description: string }>,
  multiSelect: boolean,
  customOptionText: string,
): Array<SelectionListItem<OptionItem>> {
  const list: Array<SelectionListItem<OptionItem>> = questionOptions.map((opt, i) => {
    const item: OptionItem = {
      key: `opt-${i}`,
      label: opt.label,
      description: opt.description,
      type: 'option',
      index: i,
    };
    return { key: item.key, value: item };
  });
  if (multiSelect && questionOptions.length > 1) {
    list.push({
      key: 'all',
      value: {
        key: 'all',
        label: 'All of the above',
        description: 'Select all options',
        type: 'all',
        index: list.length,
      },
    });
  }
  list.push({
    key: 'other',
    value: {
      key: 'other',
      label: customOptionText || '',
      description: '',
      type: 'other',
      index: list.length,
    },
  });
  if (multiSelect) {
    list.push({
      key: 'done',
      value: {
        key: 'done',
        label: 'Done',
        description: 'Finish selection',
        type: 'done',
        index: list.length,
      },
      hideNumber: true,
    });
  }
  return list;
}

function computeInitialChoiceState(
  initialAnswer: string | undefined,
  questionOptions: Array<{ label: string; description: string }>,
  multiSelect: boolean | undefined,
): ChoiceQuestionState {
  if (!initialAnswer) {
    return {
      selectedIndices: new Set<number>(),
      isCustomOptionSelected: false,
      isCustomOptionFocused: false,
    };
  }
  const selectedIndices = new Set<number>();
  let isCustomOptionSelected = false;
  const answers = multiSelect ? initialAnswer.split(', ') : [initialAnswer];
  answers.forEach((answer) => {
    const index = questionOptions.findIndex((opt) => opt.label === answer);
    if (index !== -1) selectedIndices.add(index);
    else isCustomOptionSelected = true;
  });
  return { selectedIndices, isCustomOptionSelected, isCustomOptionFocused: false };
}

function computeInitialCustomText(
  initialAnswer: string | undefined,
  questionOptions: Array<{ label: string; description: string }>,
  multiSelect: boolean | undefined,
): string {
  if (!initialAnswer) return '';
  if (multiSelect) {
    const answers = initialAnswer.split(', ');
    return answers.find((a) => !questionOptions.some((opt) => opt.label === a)) || '';
  }
  return questionOptions.some((opt) => opt.label === initialAnswer) ? '' : initialAnswer;
}

function handleChoiceSelect(
  itemValue: OptionItem,
  question: Question,
  questionOptionsCount: number,
  selectedIndices: Set<number>,
  isCustomOptionSelected: boolean,
  customOptionText: string,
  pastedContent: string | undefined,
  dispatch: React.Dispatch<ChoiceQuestionAction>,
  onAnswer: (answer: string) => void,
  buildAnswerString: (indices: Set<number>, includeCustom: boolean, custom: string) => string,
): void {
  if (question.multiSelect) {
    if (itemValue.type === 'option') {
      dispatch({ type: 'TOGGLE_INDEX', payload: { index: itemValue.index, multiSelect: true } });
    } else if (itemValue.type === 'other') {
      dispatch({ type: 'TOGGLE_CUSTOM_SELECTED', payload: { multiSelect: true } });
    } else if (itemValue.type === 'all') {
      dispatch({ type: 'TOGGLE_ALL', payload: { totalOptions: questionOptionsCount } });
    } else if (itemValue.type === 'done') {
      onAnswer(buildAnswerString(selectedIndices, isCustomOptionSelected, customOptionText));
    }
  } else if (itemValue.type === 'option') {
    onAnswer(itemValue.label);
  } else if (itemValue.type === 'other' && customOptionText.trim()) {
    onAnswer(
      expandPastePlaceholders(
        customOptionText,
        (pastedContent as unknown as Record<string, string>) || {},
      ).trim(),
    );
  }
}
function useChoiceQuestionExtraKeys(
  isCustomOptionFocused: boolean,
  customOptionText: string,
  customBuffer: ReturnType<typeof useTextBuffer>,
  keyMatchers: ReturnType<typeof useKeyMatchers>,
  dispatch: React.Dispatch<ChoiceQuestionAction>,
  onEditingCustomOption?: (editing: boolean) => void,
): void {
  const handleExtraKeys = useCallback(
    (key: Key) => {
      if (isCustomOptionFocused && keyMatchers[Command.QUIT](key)) {
        if (customOptionText === '') return false;
        customBuffer.setText('');
        return true;
      }
      if (
        keyMatchers[Command.DIALOG_NAVIGATION_UP](key) ||
        keyMatchers[Command.DIALOG_NAVIGATION_DOWN](key) ||
        keyMatchers[Command.DIALOG_NEXT](key) ||
        keyMatchers[Command.DIALOG_PREV](key) ||
        keyMatchers[Command.MOVE_LEFT](key) ||
        keyMatchers[Command.MOVE_RIGHT](key) ||
        keyMatchers[Command.RETURN](key) ||
        keyMatchers[Command.ESCAPE](key) ||
        keyMatchers[Command.QUIT](key)
      )
        return false;
      if (/^\d$/.test(key.sequence)) return false;
      const isPrintable =
        key.sequence &&
        !key.ctrl &&
        !key.alt &&
        (key.sequence.length > 1 || key.sequence.charCodeAt(0) >= 32);
      if (isPrintable && !isCustomOptionFocused) {
        dispatch({ type: 'SET_CUSTOM_FOCUSED', payload: { focused: true } });
        onEditingCustomOption?.(true);
        customBuffer.setText(key.sequence);
        return true;
      }
      return false;
    },
    [
      isCustomOptionFocused,
      customBuffer,
      onEditingCustomOption,
      customOptionText,
      keyMatchers,
      dispatch,
    ],
  );

  useKeypress(handleExtraKeys, { isActive: true, priority: true });
}

const ChoiceQuestionView: React.FC<ChoiceQuestionViewProps> = ({
  question,
  onAnswer,
  onSelectionChange,
  onEditingCustomOption,
  availableWidth,
  availableHeight,
  initialAnswer,
  progressHeader,
  keyboardHints,
}) => {
  const keyMatchers = useKeyMatchers();
  const isAlternateBuffer = useAlternateBuffer();
  const hasAll = question.multiSelect && (question.options?.length ?? 0) > 1;
  const numOptions = (question.options?.length ?? 0) + (hasAll ? 1 : 0) + 1;
  const horizontalPadding =
    String(numOptions).length +
    2 +
    (question.multiSelect ? 4 : 1) +
    (question.multiSelect ? 0 : 2) +
    1 +
    2;
  const bufferWidth = availableWidth - horizontalPadding;

  const questionOptions = useMemo(() => question.options ?? [], [question.options]);

  const initialReducerState = useMemo(
    () =>
      computeInitialChoiceState(
        initialAnswer,
        questionOptions as unknown as Array<{ label: string; description: string }>,
        question.multiSelect,
      ),
    [initialAnswer, questionOptions, question.multiSelect],
  );

  const [state, dispatch] = useReducer(choiceQuestionReducer, initialReducerState);
  const { selectedIndices, isCustomOptionSelected, isCustomOptionFocused } = state;

  const initialCustomText = useMemo(
    () =>
      computeInitialCustomText(
        initialAnswer,
        questionOptions as unknown as Array<{ label: string; description: string }>,
        question.multiSelect,
      ),
    [initialAnswer, questionOptions, question.multiSelect],
  );

  const customBuffer = useTextBuffer({
    initialText: initialCustomText,
    viewport: { width: Math.max(1, bufferWidth), height: 3 },
    singleLine: false,
  });
  const customOptionText = customBuffer.text;

  const buildAnswerString = useCallback(
    (indices: Set<number>, includeCustomOption: boolean, customOption: string) => {
      const answers: string[] = [];
      questionOptions.forEach((opt, i) => {
        if (indices.has(i)) answers.push(opt.label);
      });
      if (includeCustomOption && customOption.trim()) {
        answers.push(expandPastePlaceholders(customOption, customBuffer.pastedContent).trim());
      }
      return answers.join(', ');
    },
    [questionOptions, customBuffer.pastedContent],
  );

  const lastBuiltAnswerRef = useRef('');
  useEffect(() => {
    const newAnswer = buildAnswerString(selectedIndices, isCustomOptionSelected, customOptionText);
    if (newAnswer !== lastBuiltAnswerRef.current) {
      onSelectionChange?.(newAnswer);
      lastBuiltAnswerRef.current = newAnswer;
    }
  }, [
    selectedIndices,
    isCustomOptionSelected,
    customOptionText,
    buildAnswerString,
    onSelectionChange,
  ]);

  useChoiceQuestionExtraKeys(
    isCustomOptionFocused,
    customOptionText,
    customBuffer,
    keyMatchers,
    dispatch,
    onEditingCustomOption,
  );

  const selectionItems = useMemo(
    () =>
      buildChoiceSelectionItems(
        questionOptions as Array<{ label: string; description: string }>,
        !!question.multiSelect,
        customOptionText,
      ),
    [questionOptions, question.multiSelect, customOptionText],
  );

  const handleHighlight = useCallback(
    (itemValue: OptionItem) => {
      const nowFocusingCustomOption = itemValue.type === 'other';
      dispatch({ type: 'SET_CUSTOM_FOCUSED', payload: { focused: nowFocusingCustomOption } });
      onEditingCustomOption?.(nowFocusingCustomOption);
    },
    [onEditingCustomOption],
  );

  const handleSelect = useCallback(
    (itemValue: OptionItem) => {
      handleChoiceSelect(
        itemValue,
        question,
        questionOptions.length,
        selectedIndices,
        isCustomOptionSelected,
        customOptionText,
        customBuffer.pastedContent as unknown as string,
        dispatch,
        onAnswer,
        buildAnswerString,
      );
    },
    [
      question,
      questionOptions.length,
      selectedIndices,
      isCustomOptionSelected,
      customOptionText,
      customBuffer.pastedContent,
      onAnswer,
      buildAnswerString,
    ],
  );

  useEffect(() => {
    if (customOptionText.trim() && !isCustomOptionSelected)
      dispatch({
        type: 'SET_CUSTOM_SELECTED',
        payload: { selected: true, multiSelect: !!question.multiSelect },
      });
  }, [customOptionText, isCustomOptionSelected, question.multiSelect]);

  const { TITLE_MARGIN, questionHeightLimit, maxItemsToShow } = computeChoiceLayout(
    question,
    selectionItems,
    progressHeader,
    availableHeight,
    isAlternateBuffer,
  );

  const renderItem = useCallback(
    (item: SelectionListItem<OptionItem>, context: { isSelected: boolean; titleColor: string }) => {
      return renderChoiceItem(item.value, context, {
        selectedIndices,
        isCustomOptionSelected,
        questionOptions: questionOptions as Array<{ label: string; description: string }>,
        question,
        customBuffer,
        buildAnswerString,
        onAnswer,
      });
    },
    [
      selectedIndices,
      isCustomOptionSelected,
      questionOptions,
      question,
      customBuffer,
      buildAnswerString,
      onAnswer,
    ],
  );

  return (
    <Box flexDirection="column">
      {progressHeader}
      <Box marginBottom={TITLE_MARGIN}>
        <MaxSizedBox
          maxHeight={questionHeightLimit}
          maxWidth={availableWidth}
          overflowDirection="bottom"
        >
          <Box flexDirection="column">
            <MarkdownDisplay
              text={autoBoldIfPlain(question.question ?? '')}
              terminalWidth={availableWidth - DIALOG_PADDING}
              isPending={false}
            />
            {question.multiSelect && (
              <Text color={theme.text.secondary} italic>
                (Select all that apply)
              </Text>
            )}
          </Box>
        </MaxSizedBox>
      </Box>
      <BaseSelectionList<OptionItem>
        items={selectionItems}
        onSelect={handleSelect}
        onHighlight={handleHighlight}
        focusKey={isCustomOptionFocused ? 'other' : undefined}
        maxItemsToShow={maxItemsToShow}
        showScrollArrows={true}
        renderItem={renderItem}
      />
      {keyboardHints}
    </Box>
  );
};

export const AskUserDialog: React.FC<AskUserDialogProps> = ({
  questions,
  onSubmit,
  onCancel,
  onActiveTextInputChange,
  width,
  availableHeight: availableHeightProp,
  extraParts,
}) => {
  const keyMatchers = useKeyMatchers();
  const uiState = useContext(UIStateContext);
  const availableHeight =
    availableHeightProp ??
    (uiState?.constrainHeight !== false ? uiState?.availableTerminalHeight : undefined);

  const [state, dispatch] = useReducer(askUserDialogReducerLogic, initialState);
  const { answers, isEditingCustomOption, submitted } = state;

  const reviewTabIndex = questions.length;
  const tabCount = questions.length > 1 ? questions.length + 1 : questions.length;

  const { currentIndex, goToNextTab, goToPrevTab } = useTabbedNavigation({
    tabCount,
    isActive: !submitted && questions.length > 1,
    enableArrowNavigation: false, // We'll handle arrows via textBuffer callbacks or manually
    enableTabKey: false, // We'll handle tab manually to match existing behavior
  });

  const currentQuestionIndex = currentIndex;

  const handleEditingCustomOption = useCallback((isEditing: boolean) => {
    dispatch({ type: 'SET_EDITING_CUSTOM', payload: { isEditing } });
  }, []);

  useEffect(() => {
    onActiveTextInputChange?.(isEditingCustomOption);
    return () => {
      onActiveTextInputChange?.(false);
    };
  }, [isEditingCustomOption, onActiveTextInputChange]);

  const handleCancel = useCallback(
    (key: Key) => {
      if (submitted) return false;
      if (keyMatchers[Command.ESCAPE](key)) {
        onCancel();
        return true;
      } else if (keyMatchers[Command.QUIT](key)) {
        if (!isEditingCustomOption) {
          onCancel();
        }
        // Return false to let ctrl-C bubble up to AppContainer for exit flow
        return false;
      }
      return false;
    },
    [onCancel, submitted, isEditingCustomOption, keyMatchers],
  );

  useKeypress(handleCancel, {
    isActive: !submitted,
  });

  const isOnReviewTab = currentQuestionIndex === reviewTabIndex;

  const handleNavigation = useCallback(
    (key: Key) => {
      if (submitted || questions.length <= 1) return false;

      const isNextKey = keyMatchers[Command.DIALOG_NEXT](key);
      const isPrevKey = keyMatchers[Command.DIALOG_PREV](key);

      const isRight = keyMatchers[Command.MOVE_RIGHT](key);
      const isLeft = keyMatchers[Command.MOVE_LEFT](key);

      // Tab keys always trigger navigation.
      // Arrows trigger navigation if NOT in a text input OR if the input bubbles the event (already at edge).
      const shouldGoNext = isNextKey || isRight;
      const shouldGoPrev = isPrevKey || isLeft;

      if (shouldGoNext) {
        goToNextTab();
        return true;
      } else if (shouldGoPrev) {
        goToPrevTab();
        return true;
      }
      return false;
    },
    [questions.length, submitted, goToNextTab, goToPrevTab, keyMatchers],
  );

  useKeypress(handleNavigation, {
    isActive: questions.length > 1 && !submitted,
  });

  useEffect(() => {
    if (submitted) {
      onSubmit(answers);
    }
  }, [submitted, answers, onSubmit]);

  const handleAnswer = useCallback(
    (answer: string) => {
      if (submitted) return;

      if (questions.length > 1) {
        dispatch({
          type: 'SET_ANSWER',
          payload: {
            index: currentQuestionIndex,
            answer,
          },
        });
        goToNextTab();
      } else {
        dispatch({
          type: 'SET_ANSWER',
          payload: {
            index: currentQuestionIndex,
            answer,
            submit: true,
          },
        });
      }
    },
    [currentQuestionIndex, questions, submitted, goToNextTab],
  );

  const handleReviewSubmit = useCallback(() => {
    if (submitted) return;
    dispatch({ type: 'SUBMIT' });
  }, [submitted]);

  const handleSelectionChange = useCallback(
    (answer: string) => {
      if (submitted) return;
      dispatch({
        type: 'SET_ANSWER',
        payload: {
          index: currentQuestionIndex,
          answer,
        },
      });
    },
    [submitted, currentQuestionIndex],
  );

  const answeredIndices = useMemo(() => new Set(Object.keys(answers).map(Number)), [answers]);

  const currentQuestion = questions.at(currentQuestionIndex);

  const effectiveQuestion = useMemo(() => {
    if (currentQuestion?.type === 'yesno') {
      return {
        ...currentQuestion,
        options: [
          { label: 'Yes', description: '' },
          { label: 'No', description: '' },
        ],
        multiSelect: false,
      };
    }
    return currentQuestion;
  }, [currentQuestion]);

  const tabs = useMemo((): Tab[] => {
    const questionTabs: Tab[] = questions.map((q, i) => ({
      key: String(i),
      header: q.header || '',
    }));
    if (questions.length > 1) {
      questionTabs.push({
        key: 'review',
        header: 'Review',
        isSpecial: true,
      });
    }
    return questionTabs;
  }, [questions]);

  const progressHeader =
    questions.length > 1 ? (
      <TabHeader
        tabs={tabs}
        currentIndex={currentQuestionIndex}
        completedIndices={answeredIndices}
      />
    ) : null;

  if (isOnReviewTab) {
    return (
      <Box aria-label="Review your answers">
        <ReviewView
          questions={questions}
          answers={answers}
          onSubmit={handleReviewSubmit}
          progressHeader={progressHeader}
          extraParts={extraParts}
        />
      </Box>
    );
  }

  if (!currentQuestion) return null;

  return (
    <AskUserQuestionView
      currentQuestion={currentQuestion}
      currentQuestionIndex={currentQuestionIndex}
      questions={questions}
      effectiveQuestion={effectiveQuestion}
      answers={answers}
      isEditingCustomOption={isEditingCustomOption}
      width={width}
      availableHeight={availableHeight}
      progressHeader={progressHeader}
      extraParts={extraParts}
      onAnswer={handleAnswer}
      onSelectionChange={handleSelectionChange}
      onEditingCustomOption={handleEditingCustomOption}
    />
  );
};

interface AskUserQuestionViewProps {
  currentQuestion: Question;
  currentQuestionIndex: number;
  questions: Question[];
  effectiveQuestion: Question | undefined;
  answers: { [key: string]: string };
  isEditingCustomOption: boolean;
  width: number;
  availableHeight: number | undefined;
  progressHeader: React.ReactNode;
  extraParts: string[] | undefined;
  onAnswer: (answer: string) => void;
  onSelectionChange: (answer: string) => void;
  onEditingCustomOption: (isEditing: boolean) => void;
}

const AskUserQuestionView: React.FC<AskUserQuestionViewProps> = ({
  currentQuestion,
  currentQuestionIndex,
  questions,
  effectiveQuestion,
  answers,
  isEditingCustomOption,
  width,
  availableHeight,
  progressHeader,
  extraParts,
  onAnswer,
  onSelectionChange,
  onEditingCustomOption,
}) => {
  const isTextOrEditing = currentQuestion.type === 'text' || isEditingCustomOption;
  let navigationActions: string | undefined;
  if (questions.length > 1) {
    navigationActions = isTextOrEditing
      ? `${formatCommand(Command.DIALOG_NEXT)}/${formatCommand(Command.DIALOG_PREV)} to switch questions`
      : '←/→ to switch questions';
  } else if (!isTextOrEditing) {
    navigationActions = '↑/↓ to navigate';
  }

  const keyboardHints = (
    <DialogFooter
      primaryAction={isTextOrEditing ? 'Enter to submit' : 'Enter to select'}
      navigationActions={navigationActions}
      extraParts={extraParts}
    />
  );

  const initialAns = Reflect.get(answers, String(currentQuestionIndex)) as string | undefined;

  const questionView =
    currentQuestion.type === 'text' ? (
      <TextQuestionView
        key={currentQuestionIndex}
        question={currentQuestion}
        onAnswer={onAnswer}
        onSelectionChange={onSelectionChange}
        onEditingCustomOption={onEditingCustomOption}
        availableWidth={width}
        availableHeight={availableHeight}
        initialAnswer={initialAns}
        progressHeader={progressHeader}
        keyboardHints={keyboardHints}
      />
    ) : (
      <ChoiceQuestionView
        key={currentQuestionIndex}
        question={effectiveQuestion!}
        onAnswer={onAnswer}
        onSelectionChange={onSelectionChange}
        onEditingCustomOption={onEditingCustomOption}
        availableWidth={width}
        availableHeight={availableHeight}
        initialAnswer={initialAns}
        progressHeader={progressHeader}
        keyboardHints={keyboardHints}
      />
    );

  return (
    <Box
      flexDirection="column"
      width={width}
      aria-label={`Question ${currentQuestionIndex + 1} of ${questions.length}: ${currentQuestion.question}`}
    >
      {questionView}
    </Box>
  );
};
