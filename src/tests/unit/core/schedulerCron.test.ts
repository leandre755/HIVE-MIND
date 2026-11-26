import { jest, describe, it, expect, afterEach } from '@jest/globals';
type F<A extends unknown[], R> = jest.MockedFunction<(...a: A) => R>;
const m = <A extends unknown[], R>() => jest.fn<(...a: A) => R>() as unknown as F<A, R>;
const [rFn, mFn] = [m<[string, Date], Promise<void>>(), m<[string], Promise<void>>()];
const mockDb = { rescheduleReminder: rFn, markReminderSent: mFn };
const sb = { default: mockDb, db: mockDb, supabase: null };
jest.unstable_mockModule('../../../services/supabase.js', () => sb);
const { SchedulerHandler } = await import('../../../core/handlers/schedulerHandler.js');
type Doc = { context_id: string; key: string };
type Ev = { message: string; cron?: string };
type Client = { from(t: string): { insert: F<[unknown], Promise<unknown>> } };
type Internals = {
  _rescheduleCronReminder(id: string, remindAt: string, cronExpr: string): Promise<void>;
  _createReminderFromEvent(doc: Doc, ev: Ev, client: Client): Promise<boolean>;
};
describe('SchedulerHandler cron-parser v5 integration', () => {
  const origTz = process.env.TZ;
  afterEach(() => {
    if (origTz === undefined) Reflect.deleteProperty(process.env, 'TZ');
    else process.env.TZ = origTz;
  });
  it('parses recurring cron in UTC under non-UTC TZ and handles invalid inputs', async () => {
    process.env.TZ = 'America/New_York';
    const h = new SchedulerHandler(null) as unknown as Internals;
    await h._rescheduleCronReminder('r1', '2026-01-01T00:00:00.000Z', '0 9 * * *');
    expect(mFn).not.toHaveBeenCalled();
    expect(rFn.mock.calls[0]?.[1].toISOString()).toBe('2026-01-01T09:00:00.000Z');
    await h._rescheduleCronReminder('r2', '2026-01-01T00:00:00.000Z', 'bad cron');
    await h._rescheduleCronReminder('r3', 'not-a-date', '0 9 * * *');
    expect(mFn.mock.calls).toEqual([['r2'], ['r3']]);
    const insert = m<[unknown], Promise<unknown>>().mockResolvedValue({});
    const client: Client = { from: () => ({ insert }) };
    const c = (ev: Ev) => h._createReminderFromEvent({ context_id: 'c1', key: 'k' }, ev, client);
    const ok = await c({ message: 'Standup', cron: '0 9 * * *' });
    const bad = await c({ message: 'Bad', cron: 'invalid' });
    expect([ok, bad, insert.mock.calls.length]).toEqual([true, false, 1]);
    const row = { context_id: 'c1', message: '[CRON: 0 9 * * *] Standup', sent: false };
    const ra = expect.stringMatching(/T09:00:00\.000Z/);
    expect(insert).toHaveBeenCalledWith({ ...row, remind_at: ra });
  });
});
