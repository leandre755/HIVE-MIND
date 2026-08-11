import type { Key } from '../hooks/useKeypress.js';
import {
  Command,
  type KeyBindingConfig,
  defaultKeyBindingConfig,
  loadCustomKeybindings,
} from './keyBindings.js';

export { Command } from './keyBindings.js';

/**
 * Checks if a key matches any of the bindings for a command
 */
function matchCommand(
  command: Command,
  key: Key,
  config: KeyBindingConfig = defaultKeyBindingConfig,
): boolean {
  const bindings = config.get(command);
  if (!bindings) return false;
  return bindings.some((binding) => binding.matches(key));
}

/**
 * Key matcher function type
 */
type KeyMatcher = (key: Key) => boolean;

/**
 * Type for key matchers mapped to Command enum
 */
export type KeyMatchers = {
  readonly [C in Command]: KeyMatcher;
};

/**
 * Creates key matchers from a key binding configuration
 */
export function createKeyMatchers(config: KeyBindingConfig = defaultKeyBindingConfig): KeyMatchers {
  const matchers = {} as { [C in Command]: KeyMatcher };

  for (const command of Object.values(Command)) {
    Reflect.set(matchers, command, (key: Key) => matchCommand(command, key, config));
  }

  return matchers as KeyMatchers;
}

/**
 * Default key binding matchers using the default configuration
 */
export const defaultKeyMatchers: KeyMatchers = createKeyMatchers(defaultKeyBindingConfig);

/**
 * Loads and creates key matchers including user customizations.
 */
export async function loadKeyMatchers(): Promise<{
  matchers: KeyMatchers;
  errors: string[];
}> {
  const { config, errors } = await loadCustomKeybindings();
  return {
    matchers: createKeyMatchers(config),
    errors,
  };
}
