export const SESSION_DATABASE_NUMBER= 0
export const CACHE_DATABASE_NUMBER = 1
export const USERS_DATABASE_NUMBER = 2

///Job queue constants

export const MAX_CONCURRENT  = 3
export const MAX_QUEUE       = 20
export const JOB_TIMEOUT_MS  = 5 * 60 * 1000; // 5 minutes
export const MAX_OUTPUT_MB   = 10 // 10 MB
export const RATE_LIMIT_MAX  = 10 // 10 builds per minute per user
export const RATE_WINDOW_S   = 60;  // 60 seconds