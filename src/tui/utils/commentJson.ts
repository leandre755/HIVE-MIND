import { parse, stringify } from 'comment-json';
import { coreEvents } from './coreEvents.js';
import { safeExistsSync, safeWriteFileSync, safeReadFileSync } from '../../utils/safeFs.js';

/**
 * Type representing an object that may contain Symbol keys for comments.
 */
type CommentedRecord = Record<string | symbol, unknown>;

/**
 * Updates a JSON file while preserving comments and formatting.
 */
export function updateSettingsFilePreservingFormat(
  filePath: string,
  updates: Record<string, unknown>,
): void {
  if (!safeExistsSync(filePath)) {
    safeWriteFileSync(filePath, JSON.stringify(updates, null, 2));
    return;
  }

  const originalContent = safeReadFileSync(filePath);

  let parsed: Record<string, unknown>;
  try {
    parsed = parse(originalContent) as Record<string, unknown>;
  } catch (error) {
    coreEvents.emitFeedback(
      'error',
      'Error parsing settings file. Please check the JSON syntax.',
      error,
    );
    return;
  }

  const updatedStructure = applyUpdates(parsed, updates);
  const updatedContent = stringify(updatedStructure, null, 2);

  safeWriteFileSync(filePath, updatedContent);
}

function appendToSymbol(container: CommentedRecord, destSym: symbol, comments: unknown[]): void {
  if (!comments || comments.length === 0) return;
  const existing = Reflect.get(container, destSym);
  Reflect.set(container, destSym, Array.isArray(existing) ? existing.concat(comments) : comments);
}

function relocateComments(
  container: CommentedRecord,
  sym: symbol,
  comments: unknown[],
  nextKey: string | undefined,
  prevKey: string | undefined,
): void {
  if (nextKey) {
    appendToSymbol(container, Symbol.for(`before:${nextKey}`), comments);
  } else if (prevKey) {
    appendToSymbol(container, Symbol.for(`after:${prevKey}`), comments);
  } else {
    appendToSymbol(container, sym, comments);
  }
}

/**
 * When deleting a property from a comment-json parsed object, relocate any
 * leading/trailing comments that were attached to that property so they are not lost.
 *
 * This function re-attaches comments to the next sibling's leading comments if
 * available, otherwise to the previous sibling's trailing comments, otherwise
 * to the container's leading/trailing comments.
 */
function preserveCommentsOnPropertyDeletion(
  container: Record<string, unknown>,
  propName: string,
): void {
  const target = container as CommentedRecord;
  const beforeSym = Symbol.for(`before:${propName}`);
  const afterSym = Symbol.for(`after:${propName}`);

  const beforeComments = Reflect.get(target, beforeSym) as unknown[] | undefined;
  const afterComments = Reflect.get(target, afterSym) as unknown[] | undefined;

  if (!beforeComments && !afterComments) return;

  const keys = Object.getOwnPropertyNames(container);
  const idx = keys.indexOf(propName);
  const nextKey = idx >= 0 && idx + 1 < keys.length ? keys[idx + 1] : undefined;
  const prevKey = idx > 0 ? keys[idx - 1] : undefined;

  if (beforeComments && beforeComments.length > 0) {
    relocateComments(target, Symbol.for('before'), beforeComments, nextKey, prevKey);
    Reflect.deleteProperty(target, beforeSym);
  }

  if (afterComments && afterComments.length > 0) {
    relocateComments(target, Symbol.for('after'), afterComments, nextKey, prevKey);
    Reflect.deleteProperty(target, afterSym);
  }
}

/**
 * Applies sync-by-omission semantics: synchronizes base to match desired.
 * - Adds/updates keys from desired
 * - Removes keys from base that are not in desired
 * - Recursively applies to nested objects
 * - Preserves comments when deleting keys
 */
function applyKeyDiff(base: Record<string, unknown>, desired: Record<string, unknown>): void {
  for (const existingKey of Object.getOwnPropertyNames(base)) {
    if (!Object.prototype.hasOwnProperty.call(desired, existingKey)) {
      preserveCommentsOnPropertyDeletion(base, existingKey);
      Reflect.deleteProperty(base, existingKey);
    }
  }

  for (const nextKey of Object.getOwnPropertyNames(desired)) {
    const nextVal = Reflect.get(desired, nextKey);
    const baseVal = Reflect.get(base, nextKey);

    const isObj = typeof nextVal === 'object' && nextVal !== null && !Array.isArray(nextVal);
    const isBaseObj = typeof baseVal === 'object' && baseVal !== null && !Array.isArray(baseVal);
    const isArr = Array.isArray(nextVal);
    const isBaseArr = Array.isArray(baseVal);

    if (isObj && isBaseObj) {
      applyKeyDiff(baseVal as Record<string, unknown>, nextVal as Record<string, unknown>);
    } else if (isArr && isBaseArr) {
      // In-place mutate arrays to preserve array-level comments on CommentArray
      const baseArr = baseVal as unknown[];
      const desiredArr = nextVal as unknown[];
      baseArr.length = 0;
      for (const el of desiredArr) {
        baseArr.push(el);
      }
    } else {
      Reflect.set(base, nextKey, nextVal);
    }
  }
}

function applyUpdates(
  current: Record<string, unknown>,
  updates: Record<string, unknown>,
): Record<string, unknown> {
  // Apply sync-by-omission semantics consistently at all levels
  applyKeyDiff(current, updates);
  return current;
}
