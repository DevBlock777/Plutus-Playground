import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const CACHE_FILE    = path.join(__dirname, 'cache.json');
const MAX_ENTRIES   = 500;   // max number of cached compilations

// ── Helpers ──────────────────────────────────────

function readCache() {
    if (!fs.existsSync(CACHE_FILE)) return {};
    try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); }
    catch (e) { return {}; }
}

function writeCache(data) {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
}

// ── Public API ───────────────────────────────────

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
 * Returns the cache entry { cborHex, cachedAt } or null.
 */
export function getCache(hash) {
    const cache = readCache();
    const entry = cache[hash];
    if (!entry) return null;
    // Bump last-accessed so LRU eviction keeps hot entries
    entry.lastAccessed = new Date().toISOString();
    writeCache(cache);
    return entry;
}

/**
 * Store a successful compilation result.
 * Evicts the oldest entry when MAX_ENTRIES is exceeded (LRU).
 */
export function setCache(hash, cborHex) {
    const cache = readCache();

    // Evict oldest if over limit
    const keys = Object.keys(cache);
    if (keys.length >= MAX_ENTRIES) {
        const oldest = keys.sort((a, b) => {
            const ta = cache[a].lastAccessed || cache[a].cachedAt;
            const tb = cache[b].lastAccessed || cache[b].cachedAt;
            return new Date(ta) - new Date(tb);
        })[0];
        delete cache[oldest];
    }

    cache[hash] = {
        cborHex,
        cachedAt:     new Date().toISOString(),
        lastAccessed: new Date().toISOString(),
    };
    writeCache(cache);
}

/**
 * Return basic cache stats (for logging).
 */
export function cacheStats() {
    const cache = readCache();
    const keys  = Object.keys(cache);
    return { entries: keys.length, maxEntries: MAX_ENTRIES };
}
