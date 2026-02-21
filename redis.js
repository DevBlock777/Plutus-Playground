/**
 * redis.js — Shared Redis connections for Plutus IDE
 *
 * Three logical databases (Redis supports 0-15 by default):
 *   DB 0  →  sessions   (managed by connect-redis + express-session)
 *   DB 1  →  CBOR cache (managed by cache.js)
 *   DB 2  →  users      (managed by auth.js, replaces users.json)
 *
 * Install:  npm install redis connect-redis
 * Requires: Redis server running on localhost:6379
 *           or set env REDIS_URL=redis://host:port
 */

import { createClient } from 'redis';

const BASE_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

function makeClient(db) {
    const url = BASE_URL.replace(/\/\d*$/, '') + `/${db}`;
    const client = createClient({ url });
    client.on('error', (err) => console.error(`[Redis DB${db}] ${err.message}`));
    return client;
}

// One client per logical database
export const sessionClient = makeClient(0);   // express-session store
export const cacheClient   = makeClient(1);   // CBOR compilation cache
export const usersClient   = makeClient(2);   // user accounts

/**
 * Connect all clients at startup.
 * Call this once before app.listen().
 */
export async function connectRedis() {
    await Promise.all([
        sessionClient.connect(),
        cacheClient.connect(),
        usersClient.connect(),
    ]);
    console.log('[Redis] All clients connected (DB 0=sessions, 1=cache, 2=users)');
}