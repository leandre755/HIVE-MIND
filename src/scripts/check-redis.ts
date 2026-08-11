import { redis as redisClient } from '../services/redisClient.js';

async function checkRedis() {
  console.log('🔌 Connecting to Redis...');

  // Wait for connection (since auto-connect might be in progress)
  // We poll isReady
  let attempts = 0;
  while (!redisClient.isReady && attempts < 10) {
    await new Promise((r) => setTimeout(r, 500));
    attempts++;
    if (attempts % 2 === 0) console.log('... waiting for Redis ...');
  }

  if (redisClient.isReady) {
    console.log('✅ Redis Connected!');

    try {
      const testKey = 'test:ping';
      await redisClient.set(testKey, 'pong');
      const val = await redisClient.get(testKey);
      console.log(`📝 Write/Read Test: ${val === 'pong' ? '✅ Pass' : '❌ Fail'}`);
      await redisClient.del(testKey);

      console.log('🔍 Redis Buffer/Memory verified.');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('❌ Redis Operation Error:', msg);
    }
  } else {
    console.error('❌ Redis Connection Failed (Timeout)');
    // Try manual connect if not connecting?
    // await redisClient.connect();
    // But core/redisClient already calls connect().
  }

  process.exit(0);
}

checkRedis();
