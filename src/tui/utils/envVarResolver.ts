/**
 * Resolves environment variables in a string.
 * Replaces $VAR_NAME, ${VAR_NAME}, and ${VAR_NAME:-DEFAULT_VALUE} with their corresponding
 * environment variable values. If the environment variable is not defined and no default
 * value is provided, the original placeholder is preserved.
 *
 * @param value - The string that may contain environment variable placeholders
 * @param customEnv - Optional record of environment variables to use before process.env
 * @returns The string with environment variables resolved
 *
 * @example
 * resolveEnvVarsInString("Token: $API_KEY") // Returns "Token: secret-123"
 * resolveEnvVarsInString("URL: ${BASE_URL}/api") // Returns "URL: https://api.example.com/api"
 * resolveEnvVarsInString("URL: ${MISSING_VAR:-https://default.com}") // Returns "URL: https://default.com"
 * resolveEnvVarsInString("Missing: $UNDEFINED_VAR") // Returns "Missing: $UNDEFINED_VAR"
 */
export function resolveEnvVarsInString(value: string, customEnv?: Record<string, string>): string {
  const customEnvMap = new Map<string, string>(Object.entries(customEnv ?? {}));
  const processEnvMap = new Map<string, string | undefined>(Object.entries(process.env ?? {}));

  const resolveVar = (varName: string, defaultValue?: string): string | undefined => {
    const customValue = customEnvMap.get(varName);
    if (customValue !== undefined) {
      return customValue;
    }
    const envValue = processEnvMap.get(varName);
    if (envValue !== undefined) {
      return envValue;
    }
    return defaultValue;
  };

  const resolveBraced = (match: string, name: string, def: string | undefined): string => {
    const replacement = resolveVar(name, def);
    return replacement !== undefined ? replacement : match;
  };

  // Pass 1a: ${VAR_NAME:-DEFAULT_VALUE}
  let resolved = value.replace(/\$\{(\w+):-([^}]+)\}/g, (match, name, def) =>
    resolveBraced(match, name, def),
  );

  // Pass 1b: ${VAR_NAME}
  resolved = resolved.replace(/\$\{(\w+)\}/g, (match, name) =>
    resolveBraced(match, name, undefined),
  );

  // Pass 2: $VAR_NAME (without braces)
  resolved = resolved.replace(/\$(\w+)/g, (match, name) => {
    const replacement = resolveVar(name);
    return replacement !== undefined ? replacement : match;
  });

  return resolved;
}

/**
 * Recursively resolves environment variables in an object of any type.
 * Handles strings, arrays, nested objects, and preserves other primitive types.
 * Protected against circular references using a WeakSet to track visited objects.
 *
 * @param obj - The object to process for environment variable resolution
 * @returns A new object with environment variables resolved
 *
 * @example
 * const config = {
 *   server: {
 *     host: "$HOST",
 *     port: "${PORT}",
 *     enabled: true,
 *     tags: ["$ENV", "api"]
 *   }
 * };
 * const resolved = resolveEnvVarsInObject(config);
 */
export function resolveEnvVarsInObject<T>(obj: T, customEnv?: Record<string, string>): T {
  return resolveEnvVarsInObjectInternal(obj, new WeakSet(), customEnv);
}

/**
 * Internal implementation of resolveEnvVarsInObject with circular reference protection.
 *
 * @param obj - The object to process
 * @param visited - WeakSet to track visited objects and prevent circular references
 * @returns A new object with environment variables resolved
 */
function resolveEnvVarsInObjectInternal<T>(
  obj: T,
  visited: WeakSet<object>,
  customEnv?: Record<string, string>,
): T {
  if (obj === null || obj === undefined || typeof obj === 'boolean' || typeof obj === 'number') {
    return obj;
  }

  if (typeof obj === 'string') {
    return resolveEnvVarsInString(obj, customEnv) as unknown as T;
  }

  if (Array.isArray(obj)) {
    // Check for circular reference
    if (visited.has(obj)) {
      // Return a shallow copy to break the cycle
      return [...obj] as T;
    }

    visited.add(obj);
    const mapped = obj.map((item: unknown) =>
      resolveEnvVarsInObjectInternal(item, visited, customEnv),
    );
    visited.delete(obj);
    return mapped as T;
  }

  if (typeof obj === 'object') {
    // Check for circular reference
    if (visited.has(obj as object)) {
      // Return a shallow copy to break the cycle
      return { ...obj } as T;
    }

    visited.add(obj as object);
    const newObj = { ...obj } as Record<string, unknown>;
    const newObjMap = new Map<string, unknown>(Object.entries(newObj));
    for (const key of newObjMap.keys()) {
      newObjMap.set(key, resolveEnvVarsInObjectInternal(newObjMap.get(key), visited, customEnv));
    }
    visited.delete(obj as object);
    return Object.fromEntries(newObjMap) as T;
  }

  return obj;
}
