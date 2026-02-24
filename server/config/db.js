//Define redis client Pool

import "dotenv/config"
import {createClientPool} from "redis";
import { CACHE_DATABASE_NUMBER, SESSION_DATABASE_NUMBER, USERS_DATABASE_NUMBER} from "../constants.js";

const REDIS_URL = process.env.REDIS_URL 
// console.log(REDIS_URL);

function makeClient(db){
    const BASE_URL = REDIS_URL + `/${db}`
    // console.log(BASE_URL)
    const client = createClientPool({url: BASE_URL})
    client.on("error",(err)=> console.error(`[Redis DB${db}] ${err.message}`))
    return client;
}

export const sessionClient = makeClient(SESSION_DATABASE_NUMBER)
export const cacheClient = makeClient(CACHE_DATABASE_NUMBER)
export const usersClient = makeClient(USERS_DATABASE_NUMBER)


//Connect to Redis databases
//Each database can support 100 simultaneous connections
export async function connectRedis(){
    await Promise.all([
        sessionClient.connect(),
        cacheClient.connect(),
        usersClient.connect()
    ])
console.log('[Redis] All clients connected (DB sessions, cache, users)');
}