/**
 * jobQueue.js — Orchestration complète des builds
 *
 * Outcome #69789 : max concurrent builds, timeout, queue
 * Outcome #69790 : rate limiting, limits
 * Outcome #69791 : métriques, rétention logs par job
 *
 * Env vars :
 *   MAX_CONCURRENT_BUILDS  (défaut: 3)
 *   MAX_QUEUE_SIZE         (défaut: 20)
 *   JOB_TIMEOUT_MS         (défaut: 300000 = 5 min)
 *   MAX_OUTPUT_MB          (défaut: 10)
 *   RATE_LIMIT_MAX         (défaut: 10 builds/min/user)
 */

import { cacheClient } from './config/db.js';
import {MAX_CONCURRENT, MAX_QUEUE, JOB_TIMEOUT_MS, MAX_OUTPUT_MB, RATE_LIMIT_MAX, RATE_WINDOW_S} from './constants.js';


// ── Config ──────────────────────────────────────────────────────


// ── State interne ────────────────────────────────────────────────
let activeJobs = 0;
const waitQueue = [];

// ── Clés Redis ───────────────────────────────────────────────────
const M = {
    total:    'metrics:jobs:total',
    failed:   'metrics:jobs:failed',
    hits:     'metrics:cache:hits',
    misses:   'metrics:cache:misses',
    duration: 'metrics:jobs:duration_ms',
};
const LOG_TTL       = 24 * 60 * 60;  // 24h
const MAX_LOG_BYTES = 500 * 1024;    // 500 KB

// ════════════════════════════════════════════════════
//  QUEUE  (Outcome #69789)
// ════════════════════════════════════════════════════

/**
 * Acquérir un slot de compilation.
 * Retourne release() à appeler quand le job se termine.
 * Rejette si la queue est pleine.
 */
export function acquireSlot(jobId) {
    return new Promise((resolve, reject) => {
        if (activeJobs < MAX_CONCURRENT) {
            activeJobs++;
            resolve(_makeRelease());
        } else if (waitQueue.length < MAX_QUEUE) {
            waitQueue.push({ resolve, reject, jobId });
        } else {
            reject(new Error(
                `Build queue full (${MAX_QUEUE} waiting). Please retry in a moment.`
            ));
        }
    });
}

function _makeRelease() {
    let done = false;
    return function release() {
        if (done) return;
        done = true;
        activeJobs = Math.max(0, activeJobs - 1);
        if (waitQueue.length > 0 && activeJobs < MAX_CONCURRENT) {
            const next = waitQueue.shift();
            activeJobs++;
            next.resolve(_makeRelease());
        }
    };
}

// ════════════════════════════════════════════════════
//  RATE LIMITING  (Outcome #69790)
// ════════════════════════════════════════════════════

export async function checkRateLimit(userId) {
    const key = `rate_limit:${userId}`
    try {
        const count = await cacheClient.incr(key);
        if (count === 1) await cacheClient.expire(key, RATE_WINDOW_S);
        return count <= RATE_LIMIT_MAX;
    } catch (_) {
        
        return false; // fail open si Redis down
    }
}

// ════════════════════════════════════════════════════
//  METRICS  (Outcome #69791)
// ════════════════════════════════════════════════════

export async function recordJobStart()             { await cacheClient.incr(M.total).catch(() => {}); }
export async function recordJobSuccess(durationMs) { await cacheClient.incrBy(M.duration, durationMs).catch(() => {}); }
export async function recordJobFailure()           { await cacheClient.incr(M.failed).catch(() => {}); }
export async function recordCacheHit()             { await cacheClient.incr(M.hits).catch(() => {}); }
export async function recordCacheMiss()            { await cacheClient.incr(M.misses).catch(() => {}); }

export async function getMetrics() {
    try {
        const [total, failed, hits, misses, duration] = await Promise.all([
            cacheClient.get(M.total),
            cacheClient.get(M.failed),
            cacheClient.get(M.hits),
            cacheClient.get(M.misses),
            cacheClient.get(M.duration),
        ]);
        const t  = parseInt(total    || 0);
        const f  = parseInt(failed   || 0);
        const h  = parseInt(hits     || 0);
        const mi = parseInt(misses   || 0);
        const d  = parseInt(duration || 0);
        const compiled = t - h;
        return {
            jobs: {
                total:           t,
                succeeded:       t - f,
                failed:          f,
                cacheHits:       h,
                cacheMisses:     mi,
                cacheHitRate:    t > 0 ? ((h / t) * 100).toFixed(1) + '%' : 'n/a',
                avgDurationMs:   compiled > 0 ? Math.round(d / compiled) : 0,
            },
            queue: {
                active:          activeJobs,
                waiting:         waitQueue.length,
                maxConcurrent:   MAX_CONCURRENT,
                maxQueue:        MAX_QUEUE,
            },
            limits: {
                jobTimeoutMs:    JOB_TIMEOUT_MS,
                maxOutputMB:     MAX_OUTPUT_MB,
                rateLimitPerMin: RATE_LIMIT_MAX,
            },
        };
    } catch (_) {
        return { error: 'metrics unavailable' };
    }
}

// ════════════════════════════════════════════════════
//  LOG RETENTION  (Outcome #69791)
// ════════════════════════════════════════════════════

export async function appendJobLog(jobId, text) {
    const key = `job:log:${jobId}`;
    try {
        const current = (await cacheClient.get(key)) || '';
        const updated = (current + text).slice(-MAX_LOG_BYTES);
        await cacheClient.set(key, updated, { EX: LOG_TTL });
    } catch (_) {}
}

export async function getJobLog(jobId) {
    try { return (await cacheClient.get(`job:log:${jobId}`)) || null; }
    catch (_) { return null; }
}

// ════════════════════════════════════════════════════
//  ARTIFACT STORAGE  (Outcome #69788 / #69789)
// ════════════════════════════════════════════════════

export async function storeJobArtifact(jobId, data) {
    // data = { cborHex, fileName, compiledAt }
    try {
        await cacheClient.set(`job:artifact:${jobId}`, JSON.stringify(data), { EX: LOG_TTL });
    } catch (_) {}
}

export async function getJobArtifact(jobId) {
    try {
        const raw = await cacheClient.get(`job:artifact:${jobId}`);
        return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
}
