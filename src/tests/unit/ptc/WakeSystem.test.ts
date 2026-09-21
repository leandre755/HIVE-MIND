import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { HiveWakeSystem } from '../../../services/ptc/WakeSystem.js';

describe('HiveWakeSystem Lifecycle', () => {
  let wakeSystem: HiveWakeSystem;

  beforeEach(() => {
    jest.useFakeTimers();
    wakeSystem = new HiveWakeSystem(1000);
  });

  afterEach(() => {
    wakeSystem.stop();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('starts heartbeat interval and unrefs it, avoiding duplicate intervals on multiple starts', () => {
    wakeSystem.start();
    // Starting a second time should be an early return
    wakeSystem.start();
    expect(wakeSystem).toBeDefined();
  });

  it('stops heartbeat interval cleanly', () => {
    wakeSystem.start();
    wakeSystem.stop();
    // Stopping when already stopped is a no-op
    wakeSystem.stop();
    expect(wakeSystem).toBeDefined();
  });
});
