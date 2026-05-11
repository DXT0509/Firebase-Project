// Host election timing constants
export const HOST_HEARTBEAT_INTERVAL_MS = 2000; // host writes ts every 2s
export const HOST_EXPIRY_MS = 6000; // host considered dead if ts older than 6s
export const HOST_CHECK_INTERVAL_MS = 3000; // non-host checks host liveness every 3s
