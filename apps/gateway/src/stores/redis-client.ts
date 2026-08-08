import { Redis } from "@upstash/redis";

export function createRedisClient(): Redis {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      'FREELLM_STATE_BACKEND=redis requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN',
    );
  }
  return new Redis({ url, token });
}
