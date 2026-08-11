import { useState, useEffect, useRef } from 'react';
import { coreEvents, CoreEvent } from '../../utils/coreEvents.js';
import { HookStartPayload, HookEndPayload, ActiveHook } from '../contexts/UIStateContext.js';
import { WARNING_PROMPT_DURATION_MS } from '../constants.js';

function removeHookByNameAndEvent(
  prev: ActiveHook[],
  hookName: string,
  eventName?: string,
): ActiveHook[] {
  const index = prev.findIndex((h) => h.name === hookName && h.eventName === eventName);
  if (index === -1) return prev;
  const newHooks = [...prev];
  newHooks.splice(index, 1);
  return newHooks;
}

export const useHookDisplayState = () => {
  const [activeHooks, setActiveHooks] = useState<ActiveHook[]>([]);

  // Track start times independently of render state to calculate duration in event handlers
  // Key: `${hookName}:${eventName}` -> Stack of StartTimes (FIFO)
  const hookStartTimes = useRef<Map<string, number[]>>(new Map());

  // Track active timeouts to clear them on unmount
  const timeouts = useRef<Set<NodeJS.Timeout>>(new Set());

  useEffect(() => {
    const activeTimeouts = timeouts.current;
    const startTimes = hookStartTimes.current;

    const removeHook = (hookName: string, eventName?: string) => {
      setActiveHooks((prev) => removeHookByNameAndEvent(prev, hookName, eventName));
    };

    const handleHookStart = (payload: HookStartPayload) => {
      const p = payload as HookStartPayload & {
        hookName: string;
        eventName?: string;
        hookIndex?: number;
        totalHooks?: number;
        source?: string;
      };
      const key = `${p.hookName}:${p.eventName ?? ''}`;
      const now = Date.now();

      // Add start time to ref
      if (!startTimes.has(key)) {
        startTimes.set(key, []);
      }
      startTimes.get(key)!.push(now);

      setActiveHooks((prev) => [
        ...prev,
        {
          id: `${p.hookName}:${p.eventName ?? ''}:${p.hookIndex ?? 0}:${now}`,
          name: p.hookName,
          eventName: p.eventName,
          source: p.source,
          index: p.hookIndex,
          total: p.totalHooks,
        },
      ]);
    };

    const handleHookEnd = (payload: HookEndPayload) => {
      const key = `${payload.hookName}:${payload.eventName}`;
      const starts = startTimes.get(key);
      const startTime = starts?.shift(); // Get the earliest start time for this hook type

      // Cleanup empty arrays in map
      if (starts && starts.length === 0) {
        startTimes.delete(key);
      }

      const now = Date.now();
      // Default to immediate removal if start time not found (defensive)
      const elapsed = startTime ? now - startTime : WARNING_PROMPT_DURATION_MS;
      const remaining = WARNING_PROMPT_DURATION_MS - elapsed;

      if (remaining > 0) {
        const timeoutId = setTimeout(() => {
          removeHook(payload.hookName, payload.eventName);
          activeTimeouts.delete(timeoutId);
        }, remaining);
        activeTimeouts.add(timeoutId);
      } else {
        removeHook(payload.hookName, payload.eventName);
      }
    };

    coreEvents.on(CoreEvent.HookStart, handleHookStart);
    coreEvents.on(CoreEvent.HookEnd, handleHookEnd);

    return () => {
      coreEvents.off(CoreEvent.HookStart, handleHookStart);
      coreEvents.off(CoreEvent.HookEnd, handleHookEnd);
      // Clear all pending timeouts
      activeTimeouts.forEach(clearTimeout);
      activeTimeouts.clear();
    };
  }, []);

  return activeHooks;
};
