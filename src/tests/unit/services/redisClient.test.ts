import { InMemoryRedisMock, switchToMock } from '../../../services/redisClient.js';
import { workingMemory } from '../../../services/workingMemory.js';
import { createClient } from 'redis';

describe('InMemoryRedisMock - Strings & Keys', () => {
  let mock: InMemoryRedisMock;

  beforeEach(() => {
    mock = new InMemoryRedisMock();
  });

  it('should set and get basic string values', async () => {
    const setResult = await mock.set('test:key', 'hello');
    expect(setResult).toBe('OK');

    const value = await mock.get('test:key');
    expect(value).toBe('hello');
  });

  it('should return null for non-existent key', async () => {
    const value = await mock.get('non:existent');
    expect(value).toBeNull();
  });

  it('should support set with NX option (only set if not exists)', async () => {
    const first = await mock.set('lock:test', 'token1', { NX: true });
    expect(first).toBe('OK');

    const second = await mock.set('lock:test', 'token2', { NX: true });
    expect(second).toBeNull();

    expect(await mock.get('lock:test')).toBe('token1');
  });

  it('should support set with XX option (only set if already exists)', async () => {
    const initial = await mock.set('xx:test', 'val1', { XX: true });
    expect(initial).toBeNull();

    await mock.set('xx:test', 'val1');
    const updated = await mock.set('xx:test', 'val2', { XX: true });
    expect(updated).toBe('OK');
    expect(await mock.get('xx:test')).toBe('val2');
  });

  it('should support set with PX (millisecond TTL) and expire correctly', async () => {
    await mock.set('px:test', 'val', { PX: 50 });
    expect(await mock.get('px:test')).toBe('val');

    await new Promise((r) => setTimeout(r, 60));
    expect(await mock.get('px:test')).toBeNull();
    expect(await mock.exists('px:test')).toBe(0);
  });

  it('should support setEx and expire', async () => {
    await mock.setEx('setex:test', 10, 'val');
    expect(await mock.get('setex:test')).toBe('val');

    const expireResult = await mock.expire('setex:test', 60);
    expect(expireResult).toBe(1);

    const nonExistentExpire = await mock.expire('missing', 60);
    expect(nonExistentExpire).toBe(0);
  });

  it('should support del across multiple keys', async () => {
    await mock.set('k1', 'v1');
    await mock.set('k2', 'v2');
    await mock.set('k3', 'v3');

    const deleted = await mock.del('k1', 'k2');
    expect(deleted).toBe(2);
    expect(await mock.get('k1')).toBeNull();
    expect(await mock.get('k2')).toBeNull();
    expect(await mock.get('k3')).toBe('v3');
  });

  it('should support keys pattern matching', async () => {
    await mock.set('chat:123:context', 'data1');
    await mock.set('chat:456:context', 'data2');
    await mock.set('other:key', 'data3');

    const matched = await mock.keys('chat:*:context');
    expect(matched).toHaveLength(2);
    expect(matched).toContain('chat:123:context');
    expect(matched).toContain('chat:456:context');

    const allKeys = await mock.keys('*');
    expect(allKeys).toHaveLength(3);
  });

  it('should support incr and incrBy', async () => {
    const i1 = await mock.incr('counter');
    expect(i1).toBe(1);

    const i2 = await mock.incrBy('counter', 5);
    expect(i2).toBe(6);
  });

  it('should report ping, info and quit', async () => {
    expect(await mock.ping()).toBe('PONG');
    expect(await mock.info()).toContain('used_memory_human');
    await mock.quit();
    expect(mock.isOpen).toBe(false);
    expect(mock.isReady).toBe(false);
  });
});

describe('InMemoryRedisMock - Lists (rPush, lPush, lTrim, lRange, lRem)', () => {
  let mock: InMemoryRedisMock;

  beforeEach(() => {
    mock = new InMemoryRedisMock();
  });

  it('should rPush and lRange elements correctly', async () => {
    const len1 = await mock.rPush('list:test', 'msg1');
    expect(len1).toBe(1);

    const len2 = await mock.rPush('list:test', 'msg2', 'msg3');
    expect(len2).toBe(3);

    const all = await mock.lRange('list:test', 0, -1);
    expect(all).toEqual(['msg1', 'msg2', 'msg3']);
  });

  it('should support array arguments in rPush and lPush', async () => {
    await mock.rPush('list:arr', ['a', 'b']);
    expect(await mock.lRange('list:arr', 0, -1)).toEqual(['a', 'b']);

    await mock.lPush('list:arr', ['c', 'd']);
    expect(await mock.lRange('list:arr', 0, -1)).toEqual(['d', 'c', 'a', 'b']);
  });

  it('should lTrim list with positive and negative indices (context window trimming)', async () => {
    for (let i = 1; i <= 20; i++) {
      await mock.rPush('chat:ctx', `msg_${i}`);
    }
    expect(await mock.lLen('chat:ctx')).toBe(20);

    const trimRes = await mock.lTrim('chat:ctx', -15, -1);
    expect(trimRes).toBe('OK');

    const remaining = await mock.lRange('chat:ctx', 0, -1);
    expect(remaining).toHaveLength(15);
    expect(remaining.at(0)).toBe('msg_6');
    expect(remaining.at(-1)).toBe('msg_20');
  });

  it('should handle lTrim with start > stop by emptying list', async () => {
    await mock.rPush('trim:test', 'a', 'b', 'c');
    await mock.lTrim('trim:test', 5, 2);
    expect(await mock.lRange('trim:test', 0, -1)).toEqual([]);
  });

  it('should pop elements with rPop and lPop', async () => {
    await mock.rPush('queue', 'first', 'second', 'third');

    expect(await mock.rPop('queue')).toBe('third');
    expect(await mock.lPop('queue')).toBe('first');
    expect(await mock.lRange('queue', 0, -1)).toEqual(['second']);

    expect(await mock.rPop('queue')).toBe('second');
    expect(await mock.rPop('queue')).toBeNull();
    expect(await mock.lPop('queue')).toBeNull();
  });

  it('should lRem elements correctly for count > 0, count < 0, and count = 0', async () => {
    await mock.rPush('dup:list', 'x', 'y', 'x', 'x', 'z');

    const rem1 = await mock.lRem('dup:list', 1, 'x');
    expect(rem1).toBe(1);
    expect(await mock.lRange('dup:list', 0, -1)).toEqual(['y', 'x', 'x', 'z']);

    const rem2 = await mock.lRem('dup:list', -1, 'x');
    expect(rem2).toBe(1);
    expect(await mock.lRange('dup:list', 0, -1)).toEqual(['y', 'x', 'z']);

    const remAll = await mock.lRem('dup:list', 0, 'y');
    expect(remAll).toBe(1);
    expect(await mock.lRange('dup:list', 0, -1)).toEqual(['x', 'z']);
  });

  it('should support negative start in lRange', async () => {
    await mock.rPush('hist', '1', '2', '3', '4', '5');
    const lastThree = await mock.lRange('hist', -3, -1);
    expect(lastThree).toEqual(['3', '4', '5']);
  });
});

describe('InMemoryRedisMock - Sets & Hashes (hDel, hLen, sCard)', () => {
  let mock: InMemoryRedisMock;

  beforeEach(() => {
    mock = new InMemoryRedisMock();
  });

  it('should manage sets with sAdd, sMembers, sIsMember, sCard, sRem', async () => {
    const added = await mock.sAdd('myset', ['user1', 'user2', 'user1']);
    expect(added).toBe(2);
    expect(await mock.sCard('myset')).toBe(2);
    expect(await mock.sIsMember('myset', 'user1')).toBe(true);
    expect(await mock.sIsMember('myset', 'user3')).toBe(false);

    const members = await mock.sMembers('myset');
    expect(members).toHaveLength(2);
    expect(members).toContain('user1');
    expect(members).toContain('user2');

    const removed = await mock.sRem('myset', 'user1');
    expect(removed).toBe(1);
    expect(await mock.sCard('myset')).toBe(1);
  });

  it('should support sPop and sPopCount', async () => {
    await mock.sAdd('sync:queue', ['uuid1', 'uuid2', 'uuid3']);

    const batch = await mock.sPopCount('sync:queue', 2);
    expect(batch).toHaveLength(2);
    expect(await mock.sCard('sync:queue')).toBe(1);

    const last = await mock.sPop('sync:queue');
    expect(last).toBeDefined();
    expect(await mock.sCard('sync:queue')).toBe(0);
  });

  it('should manage hashes with hSet, hGet, hGetAll, hIncrBy, hDel, hLen', async () => {
    await mock.hSet('user:100', { name: 'Alice', role: 'admin' });
    expect(await mock.hGet('user:100', 'name')).toBe('Alice');
    expect(await mock.hLen('user:100')).toBe(2);

    const incremented = await mock.hIncrBy('user:100', 'visits', 3);
    expect(incremented).toBe(3);
    expect(await mock.hLen('user:100')).toBe(3);

    const all = await mock.hGetAll('user:100');
    expect(all).toEqual({ name: 'Alice', role: 'admin', visits: '3' });

    const deletedCount = await mock.hDel('user:100', 'role', 'non_existent');
    expect(deletedCount).toBe(1);
    expect(await mock.hLen('user:100')).toBe(2);
    expect(await mock.hGet('user:100', 'role')).toBeNull();
  });

  it('should support hExists', async () => {
    await mock.hSet('hash:test', 'key1', 'val1');
    expect(await mock.hExists('hash:test', 'key1')).toBe(1);
    expect(await mock.hExists('hash:test', 'missing')).toBe(0);
  });
});

describe('InMemoryRedisMock - Sorted Sets (zAdd, zRangeByScore, zRemRangeByScore, zCard)', () => {
  let mock: InMemoryRedisMock;

  beforeEach(() => {
    mock = new InMemoryRedisMock();
  });

  it('should support zAdd polymorphism (object vs array vs positional)', async () => {
    const count1 = await mock.zAdd('zkey', { score: 100, value: 'item1' });
    expect(count1).toBe(1);

    const count2 = await mock.zAdd('zkey', [
      { score: 200, value: 'item2' },
      { score: 300, value: 'item3' },
    ]);
    expect(count2).toBe(2);

    const count3 = await mock.zAdd('zkey', 400, 'item4');
    expect(count3).toBe(1);

    expect(await mock.zCard('zkey')).toBe(4);
    expect(await mock.zScore('zkey', 'item2')).toBe(200);

    const updateCount = await mock.zAdd('zkey', { score: 250, value: 'item2' });
    expect(updateCount).toBe(0);
    expect(await mock.zScore('zkey', 'item2')).toBe(250);
  });

  it('should support zRangeWithScores with REV option', async () => {
    await mock.zAdd('leaderboard', [
      { score: 10, value: 'userA' },
      { score: 50, value: 'userB' },
      { score: 30, value: 'userC' },
    ]);

    const asc = await mock.zRangeWithScores('leaderboard', 0, -1);
    expect(asc.map((e) => e.value)).toEqual(['userA', 'userC', 'userB']);

    const desc = await mock.zRangeWithScores('leaderboard', 0, -1, { REV: true });
    expect(desc.map((e) => e.value)).toEqual(['userB', 'userC', 'userA']);
  });

  it('should support zRangeByScore with -inf, +inf, and numeric ranges', async () => {
    await mock.zAdd('scores', [
      { score: 10, value: 'low' },
      { score: 50, value: 'mid' },
      { score: 90, value: 'high' },
    ]);

    const under60 = await mock.zRangeByScore('scores', '-inf', 60);
    expect(under60).toEqual(['low', 'mid']);

    const above40 = await mock.zRangeByScore('scores', 40, '+inf');
    expect(above40).toEqual(['mid', 'high']);

    const exclusive = await mock.zRangeByScore('scores', '(10', 90);
    expect(exclusive).toEqual(['mid', 'high']);
  });

  it('should support zRemRangeByScore', async () => {
    await mock.zAdd('velocity', [
      { score: 1000, value: 'v1' },
      { score: 2000, value: 'v2' },
      { score: 3000, value: 'v3' },
    ]);

    const removed = await mock.zRemRangeByScore('velocity', '-inf', 2000);
    expect(removed).toBe(2);
    expect(await mock.zCard('velocity')).toBe(1);
    expect(await mock.zScore('velocity', 'v3')).toBe(3000);
  });

  it('should support zIncrBy and zRem', async () => {
    await mock.zAdd('active', 10, 'node1');
    const newScore = await mock.zIncrBy('active', 5, 'node1');
    expect(newScore).toBe(15);

    const remCount = await mock.zRem('active', 'node1');
    expect(remCount).toBe(1);
    expect(await mock.zCard('active')).toBe(0);
  });
});

describe('InMemoryRedisMock - Eval (LockManager atomic script)', () => {
  let mock: InMemoryRedisMock;

  beforeEach(() => {
    mock = new InMemoryRedisMock();
  });

  it('should evaluate LockManager release script with matching lockId', async () => {
    await mock.set('lock:resource', 'my-lock-id');

    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
      else
          return 0
      end
    `;

    const res = await mock.eval(script, {
      keys: ['lock:resource'],
      arguments: ['my-lock-id'],
    });

    expect(res).toBe(1);
    expect(await mock.get('lock:resource')).toBeNull();
  });

  it('should not release lock if lockId does not match', async () => {
    await mock.set('lock:resource', 'correct-token');

    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
      else
          return 0
      end
    `;

    const res = await mock.eval(script, {
      keys: ['lock:resource'],
      arguments: ['wrong-token'],
    });

    expect(res).toBe(0);
    expect(await mock.get('lock:resource')).toBe('correct-token');
  });

  it('should handle simple return redis.call scripts', async () => {
    await mock.set('test:key', 'some-value');

    const res = await mock.eval('return redis.call("get", KEYS[1])', {
      keys: ['test:key'],
      arguments: [],
    });

    expect(res).toBe('some-value');
  });
});

describe('InMemoryRedisMock - Multi Pipeline', () => {
  let mock: InMemoryRedisMock;

  beforeEach(() => {
    mock = new InMemoryRedisMock();
  });

  it('should execute chained pipeline operations atomically', async () => {
    const pipeline = mock.multi();
    pipeline
      .hIncrBy('user:data', 'interaction_count', 1)
      .hSet('user:data', 'last_seen', 123456)
      .expire('user:data', 86400)
      .sAdd('sync:queue', 'user-uuid-1');

    const results = await pipeline.exec();
    expect(results).toHaveLength(4);
    expect(results.at(0)).toBe(1);
    expect(results.at(1)).toBe(1);
    expect(results.at(2)).toBe(1);
    expect(results.at(3)).toBe(1);

    expect(await mock.hGet('user:data', 'interaction_count')).toBe('1');
    expect(await mock.sIsMember('sync:queue', 'user-uuid-1')).toBe(true);
  });

  it('should support list operations in multi', async () => {
    const pipeline = mock.multi();
    pipeline.rPush('items', 'a').rPush('items', 'b').lTrim('items', 0, 0);

    const results = await pipeline.exec();
    expect(results).toHaveLength(3);
    expect(await mock.lRange('items', 0, -1)).toEqual(['a']);
  });

  it('should support discard in multi to clear queued operations', async () => {
    const pipeline = mock.multi();
    pipeline.rPush('discard_key', 'val1');
    const discardResult = pipeline.discard();
    expect(discardResult).toBe('OK');

    const results = await pipeline.exec();
    expect(results).toEqual([]);
    expect(await mock.exists('discard_key')).toBe(0);
  });
});

describe('InMemoryRedisMock - Edge cases and advanced semantics', () => {
  let mock: InMemoryRedisMock;

  beforeEach(() => {
    mock = new InMemoryRedisMock();
  });

  it('should remove keys from keyspace when sets become empty (sRem, sPop, sPopCount)', async () => {
    await mock.sAdd('set_rem', 'a');
    await mock.sRem('set_rem', 'a');
    expect(await mock.exists('set_rem')).toBe(0);
    expect(await mock.keys('set_rem')).toHaveLength(0);

    await mock.sAdd('set_pop', 'b');
    await mock.sPop('set_pop');
    expect(await mock.exists('set_pop')).toBe(0);

    await mock.sAdd('set_popc', ['c1', 'c2']);
    await mock.sPopCount('set_popc', 2);
    expect(await mock.exists('set_popc')).toBe(0);
  });

  it('should remove keys from keyspace when lists become empty (rPop, lPop, lTrim, lRem)', async () => {
    await mock.rPush('list_rpop', 'x');
    await mock.rPop('list_rpop');
    expect(await mock.exists('list_rpop')).toBe(0);

    await mock.rPush('list_lpop', 'y');
    await mock.lPop('list_lpop');
    expect(await mock.exists('list_lpop')).toBe(0);

    await mock.rPush('list_trim', 'z');
    await mock.lTrim('list_trim', 5, 2);
    expect(await mock.exists('list_trim')).toBe(0);

    await mock.rPush('list_rem', 'w');
    await mock.lRem('list_rem', 0, 'w');
    expect(await mock.exists('list_rem')).toBe(0);
  });

  it('should return 0 when del is called on an already expired key', async () => {
    await mock.set('exp_key', 'val', { PX: 20 });
    await new Promise((r) => setTimeout(r, 40));

    const delCount = await mock.del('exp_key');
    expect(delCount).toBe(0);
  });

  it('should flatten array arguments in exists', async () => {
    await mock.set('arr_k1', 'v1');
    await mock.set('arr_k2', 'v2');

    const count = await mock.exists(['arr_k1', 'arr_k2']);
    expect(count).toBe(2);
  });

  it('should handle bracket notation in zRangeByScore', async () => {
    await mock.zAdd('bracket_z', [
      { score: 10, value: 'ten' },
      { score: 20, value: 'twenty' },
      { score: 30, value: 'thirty' },
    ]);

    const res = await mock.zRangeByScore('bracket_z', '[10', '[20');
    expect(res).toEqual(['ten', 'twenty']);
  });

  it('should support zRange and lexicographical tie-breaking in zRangeWithScores', async () => {
    await mock.zAdd('tie_z', [
      { score: 10, value: 'cherry' },
      { score: 10, value: 'apple' },
      { score: 10, value: 'banana' },
    ]);

    const rangeVals = await mock.zRange('tie_z', 0, -1);
    expect(rangeVals).toEqual(['apple', 'banana', 'cherry']);

    const withScores = await mock.zRangeWithScores('tie_z', 0, -1);
    expect(withScores.map((e) => e.value)).toEqual(['apple', 'banana', 'cherry']);

    const revRange = await mock.zRange('tie_z', 0, -1, { REV: true });
    expect(revRange).toEqual(['cherry', 'banana', 'apple']);
  });

  it('should support zAdd options (NX, XX, GT, LT, CH)', async () => {
    // Initial add
    await mock.zAdd('opts_z', 10, 'elem1');

    // NX should not update existing
    const nxAdd = await mock.zAdd('opts_z', 20, 'elem1', { NX: true });
    expect(nxAdd).toBe(0);
    expect(await mock.zScore('opts_z', 'elem1')).toBe(10);

    // XX should not add new
    const xxAdd = await mock.zAdd('opts_z', 50, 'elem_new', { XX: true });
    expect(xxAdd).toBe(0);
    expect(await mock.zScore('opts_z', 'elem_new')).toBeNull();

    // XX should update existing
    const xxUpdate = await mock.zAdd('opts_z', 30, 'elem1', { XX: true });
    expect(xxUpdate).toBe(0);
    expect(await mock.zScore('opts_z', 'elem1')).toBe(30);

    // CH option returns count of changed elements
    const chUpdate = await mock.zAdd('opts_z', 40, 'elem1', { CH: true });
    expect(chUpdate).toBe(1);
  });

  it('should support hSet with flat array and array of tuples', async () => {
    await mock.hSet('hash_arr', ['f1', 'v1', 'f2', 'v2']);
    expect(await mock.hGetAll('hash_arr')).toEqual({ f1: 'v1', f2: 'v2' });

    await mock.hSet('hash_tuples', [
      ['k1', 'val1'],
      ['k2', 'val2'],
    ]);
    expect(await mock.hGetAll('hash_tuples')).toEqual({ k1: 'val1', k2: 'val2' });
  });

  it('should evaluate Lua scripts with camelCase commands and comma in strings', async () => {
    await mock.hSet('user:eval', 'nickname', 'Neo');

    // camelCase method resolution for 'hget'
    const hgetRes = await mock.eval('return redis.call("hget", KEYS[1], ARGV[1])', {
      keys: ['user:eval'],
      arguments: ['nickname'],
    });
    expect(hgetRes).toBe('Neo');

    // Comma inside quoted string argument
    await mock.eval('return redis.call("set", KEYS[1], "hello, world")', {
      keys: ['str:comma'],
      arguments: [],
    });
    expect(await mock.get('str:comma')).toBe('hello, world');
  });
});

describe('switchToMock and WorkingMemory Integration', () => {
  it('should dynamically bind all mock methods, allow isReady mutation, and prevent rPush crashes in workingMemory', async () => {
    const dummyClient = createClient({ url: 'redis://localhost:6379' });
    switchToMock(dummyClient);

    expect(dummyClient.isOpen).toBe(true);
    expect(dummyClient.isReady).toBe(true);
    expect(typeof dummyClient.rPush).toBe('function');
    expect(typeof dummyClient.lTrim).toBe('function');
    expect(typeof dummyClient.zAdd).toBe('function');
    expect(typeof dummyClient.zRange).toBe('function');
    expect(typeof dummyClient.zRangeByScore).toBe('function');
    expect(typeof dummyClient.hDel).toBe('function');
    expect(typeof dummyClient.hLen).toBe('function');
    expect(typeof dummyClient.eval).toBe('function');

    // Verify setters work without throwing TypeError in strict mode
    const mutableClient = dummyClient as unknown as { isReady: boolean; isOpen: boolean };
    mutableClient.isReady = false;
    expect(dummyClient.isReady).toBe(false);
    mutableClient.isReady = true;
    expect(dummyClient.isReady).toBe(true);

    const chatId = 'test_chat_integration_123';
    await workingMemory.clearContext(chatId);

    // This previously crashed with TypeError: redis.rPush is not a function
    await workingMemory.addMessage(chatId, 'user', 'Hello HiveMind');
    await workingMemory.addMessage(chatId, 'assistant', 'Hello! How can I assist you?');

    const context = await workingMemory.getContext(chatId);
    expect(context).toHaveLength(2);
    expect(context.at(0)?.content).toBe('Hello HiveMind');
    expect(context.at(1)?.content).toBe('Hello! How can I assist you?');

    await workingMemory.clearContext(chatId);
  });
});
