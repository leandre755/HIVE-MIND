import { MergeStrategy } from '../config/hiveSettingsSchema.js';

export type Mergeable = string | number | boolean | null | undefined | object | Mergeable[];

export type MergeableObject = Record<string, Mergeable>;

function isPlainObject(item: unknown): item is MergeableObject {
  return !!item && typeof item === 'object' && !Array.isArray(item);
}

function applyShallowMerge(
  targetMap: Map<string, Mergeable>,
  key: string,
  objValue: Mergeable,
  srcValue: Mergeable,
): boolean {
  const obj1 = typeof objValue === 'object' && objValue !== null ? objValue : {};
  const obj2 = typeof srcValue === 'object' && srcValue !== null ? srcValue : {};
  targetMap.set(key, { ...obj1, ...obj2 });
  return true;
}

function applyArrayMerge(
  targetMap: Map<string, Mergeable>,
  key: string,
  objValue: Mergeable,
  srcValue: Mergeable,
  mergeStrategy: MergeStrategy | undefined,
): boolean {
  if (!Array.isArray(objValue)) {
    return false;
  }
  const srcArray = Array.isArray(srcValue) ? srcValue : [srcValue];
  if (mergeStrategy === MergeStrategy.CONCAT) {
    targetMap.set(key, objValue.concat(srcArray));
    return true;
  }
  if (mergeStrategy === MergeStrategy.UNION) {
    targetMap.set(key, [...new Set(objValue.concat(srcArray))]);
    return true;
  }
  return false;
}

function mergeRecursively(
  target: MergeableObject,
  source: MergeableObject,
  getMergeStrategyForPath: (path: string[]) => MergeStrategy | undefined,
  keyPath: string[] = [],
) {
  const targetMap = new Map<string, Mergeable>(Object.entries(target));
  const sourceMap = new Map<string, Mergeable>(Object.entries(source));

  for (const [key, srcValue] of sourceMap) {
    // JSON.parse can create objects with __proto__ as an own property.
    // We must skip it to prevent prototype pollution.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    if (srcValue === undefined) {
      continue;
    }
    const nextPath = [...keyPath, key];
    const objValue = targetMap.get(key);
    const mergeStrategy = getMergeStrategyForPath(nextPath);

    if (mergeStrategy === MergeStrategy.SHALLOW_MERGE && objValue && srcValue) {
      applyShallowMerge(targetMap, key, objValue, srcValue);
      continue;
    }

    if (applyArrayMerge(targetMap, key, objValue, srcValue, mergeStrategy)) {
      continue;
    }

    if (isPlainObject(objValue) && isPlainObject(srcValue)) {
      mergeRecursively(objValue, srcValue, getMergeStrategyForPath, nextPath);
    } else if (isPlainObject(srcValue)) {
      const nextTarget: MergeableObject = {};
      targetMap.set(key, nextTarget);
      mergeRecursively(nextTarget, srcValue, getMergeStrategyForPath, nextPath);
    } else {
      targetMap.set(key, srcValue);
    }
  }
  return Object.fromEntries(targetMap) as MergeableObject;
}

export function customDeepMerge(
  getMergeStrategyForPath: (path: string[]) => MergeStrategy | undefined,
  ...sources: MergeableObject[]
): MergeableObject {
  const result: MergeableObject = {};

  for (const source of sources) {
    if (source) {
      mergeRecursively(result, source, getMergeStrategyForPath);
    }
  }

  return result;
}
