import {rateLimit} from "express-rate-limit"
const RATE_LIMIT_MAX = 60
const TIME = 60 * 1000 // 1 minute

const LIMITER = rateLimit({
windowMs: TIME,
limit: RATE_LIMIT_MAX
})

export function applyRateLimiter(req,res,next){
    
    return LIMITER(req,res,next)
}