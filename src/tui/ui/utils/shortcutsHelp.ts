import { Command } from '../key/keyMatchers.js';
import type { Key } from '../hooks/useKeypress.js';
import { useKeyMatchers } from '../hooks/useKeyMatchers.js';

export function useIsHelpDismissKey(): (key: Key) => boolean {
  const keyMatchers = useKeyMatchers();
  return (key: Key) =>
    Object.values(Command).some((command) => {
      const matcher = Reflect.get(keyMatchers, command) as (k: Key) => boolean;
      return matcher ? matcher(key) : false;
    });
}
