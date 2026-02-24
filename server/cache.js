/**
 * cache.js — CBOR compilation cache backed by Redis (DB 1)
 *
 * Replaces the previous cache.json file-based implementation.
 * Keys: sha256 of normalised Haskell source
 * TTL:  30 days (auto-expiry, no manual eviction needed)
 */

import crypto from 'crypto';
import { cacheClient } from './config/db.js';

const TTL_SECONDS = 30 * 24 * 60 * 60;   // 30 days
const KEY_PREFIX  = 'cbor:';

/**
 * Compute a deterministic SHA-256 hash of Haskell source code.
 * Normalises line endings so Windows/Unix differences don't bust the cache.
 */
export function hashSource(source) {
    const normalised = source.replace(/\r\n/g, '\n').trimEnd();
    return crypto.createHash('sha256').update(normalised).digest('hex');
}

/**
 * Look up a compiled CBOR result by source hash.
 * Returns { cborHex, cachedAt } or null on miss.
 */
export async function getCache(hash) {
    const raw = await cacheClient.get(KEY_PREFIX + hash);
    if (!raw) return null;
    try {
        // Refresh TTL on every hit (keeps hot entries alive)
        await cacheClient.expire(KEY_PREFIX + hash, TTL_SECONDS);
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/**
 * Store a successful compilation result with 30-day TTL.
 */
export async function setCache(hash, cborHex) {
    const entry = { cborHex, cachedAt: new Date().toISOString() };
    await cacheClient.set(KEY_PREFIX + hash, JSON.stringify(entry), {
        EX: TTL_SECONDS,
    });
}

/**
 * Basic cache stats for display in SSE output.
 */
export async function cacheStats() {
    const keys = await cacheClient.keys(KEY_PREFIX + '*');
    return { entries: keys.length, ttlDays: Math.round(TTL_SECONDS / 86400) };
}