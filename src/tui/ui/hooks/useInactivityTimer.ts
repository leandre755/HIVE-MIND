import { useState, useEffect, useRef } from 'react';

/**
 * Returns true after a specified delay of inactivity.
 * Inactivity is defined as 'trigger' not changing for 'delayMs' milliseconds.
 *
 * @param isActive Whether the timer should be running.
 * @param trigger Any value that, when changed, resets the inactivity timer.
 * @param delayMs The delay in milliseconds before considering the state inactive.
 */
export const useInactivityTimer = (
  isActive: boolean,
  trigger: unknown,
  delayMs: number = 5000,
): boolean => {
  const [isInactive, setIsInactive] = useState(false);
  const prevTriggerRef = useRef(trigger);

  useEffect(() => {
    if (!isActive) {
      setIsInactive((prev) => (prev ? false : prev));
      return;
    }

    if (prevTriggerRef.current !== trigger) {
      prevTriggerRef.current = trigger;
      setIsInactive((prev) => (prev ? false : prev));
    }

    const timer = setTimeout(() => {
      setIsInactive(true);
    }, delayMs);

    return () => clearTimeout(timer);
  }, [isActive, trigger, delayMs]);

  return isInactive;
};
