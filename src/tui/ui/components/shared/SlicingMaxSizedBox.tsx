import { useMemo } from 'react';
import { MaxSizedBox, type MaxSizedBoxProps } from './MaxSizedBox.js';

// Large threshold to ensure we don't cause performance issues for very large
// outputs that will get truncated further MaxSizedBox anyway.
const MAXIMUM_RESULT_DISPLAY_CHARACTERS = 20000;

export interface SlicingMaxSizedBoxProps<T> extends Omit<MaxSizedBoxProps, 'children'> {
  data: T;
  maxLines?: number;
  isAlternateBuffer?: boolean;
  children: (truncatedData: T) => React.ReactNode;
}

/**
 * An extension of MaxSizedBox that performs explicit slicing of the input data
 * (string or array) before rendering. This is useful for performance and to
 * ensure consistent truncation behavior for large outputs.
 */
function sliceStringData(
  data: string,
  maxLines: number | undefined,
  overflowDirection: 'top' | 'bottom',
): { truncatedData: string; hiddenLinesCount: number } {
  let text = data;
  if (text.length > MAXIMUM_RESULT_DISPLAY_CHARACTERS) {
    text =
      overflowDirection === 'bottom'
        ? text.slice(0, MAXIMUM_RESULT_DISPLAY_CHARACTERS) + '...'
        : '...' + text.slice(-MAXIMUM_RESULT_DISPLAY_CHARACTERS);
  }

  if (maxLines === undefined) {
    return { truncatedData: text, hiddenLinesCount: 0 };
  }

  const hasTrailingNewline = text.endsWith('\n');
  const contentText = hasTrailingNewline ? text.slice(0, -1) : text;
  const lines = contentText.split('\n');
  if (lines.length <= maxLines) {
    return { truncatedData: text, hiddenLinesCount: 0 };
  }

  const targetLines = Math.max(1, maxLines - 1);
  const hiddenLines = lines.length - targetLines;
  const sliced =
    overflowDirection === 'bottom' ? lines.slice(0, targetLines) : lines.slice(-targetLines);
  const slicedText = sliced.join('\n') + (hasTrailingNewline ? '\n' : '');

  return { truncatedData: slicedText, hiddenLinesCount: hiddenLines };
}

function sliceArrayData<T>(
  data: T[],
  maxLines: number | undefined,
  overflowDirection: 'top' | 'bottom',
): { truncatedData: T[]; hiddenLinesCount: number } {
  if (maxLines === undefined || data.length <= maxLines) {
    return { truncatedData: data, hiddenLinesCount: 0 };
  }
  const targetLines = Math.max(1, maxLines - 1);
  const hiddenCount = data.length - targetLines;
  const sliced =
    overflowDirection === 'bottom' ? data.slice(0, targetLines) : data.slice(-targetLines);
  return { truncatedData: sliced, hiddenLinesCount: hiddenCount };
}

export function SlicingMaxSizedBox<T>({
  data,
  maxLines,
  isAlternateBuffer,
  children,
  ...boxProps
}: SlicingMaxSizedBoxProps<T>) {
  const { truncatedData, hiddenLinesCount } = useMemo(() => {
    const overflowDirection = boxProps.overflowDirection ?? 'top';

    if (typeof data === 'string' && !isAlternateBuffer) {
      return sliceStringData(data, maxLines, overflowDirection) as {
        truncatedData: T;
        hiddenLinesCount: number;
      };
    }

    if (Array.isArray(data) && !isAlternateBuffer) {
      return sliceArrayData(data, maxLines, overflowDirection) as unknown as {
        truncatedData: T;
        hiddenLinesCount: number;
      };
    }

    return { truncatedData: data, hiddenLinesCount: 0 };
  }, [data, isAlternateBuffer, maxLines, boxProps.overflowDirection]);

  return (
    <MaxSizedBox
      {...boxProps}
      additionalHiddenLinesCount={(boxProps.additionalHiddenLinesCount ?? 0) + hiddenLinesCount}
    >
      {}
      {children(truncatedData as unknown as T)}
    </MaxSizedBox>
  );
}
