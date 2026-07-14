/**
 * Redis Lua Scripts for atomic email routing operations.
 *
 * All scripts run atomically — single Redis round trip, no race conditions.
 * Critical for high-concurrency scenarios (100+ workers reassigning simultaneously).
 *
 * Usage:
 *   const result = await redis.eval(ATOMIC_REASSIGN, 3, leadKey, oldMbKey, newMbKey, ...args);
 */

// ─── ATOMIC_REASSIGN ──────────────────────────────────────────────────────────
// Atomically:
//   1. Read current lead assignment
//   2. Verify it matches expected state (prevents double-reassign)
//   3. Write new assignment
//   4. Decrement old mailbox load counter
//   5. Increment new mailbox load counter
//   6. Publish reassign event to pub/sub channel
//
// KEYS[1] = lead:assign:{campaignLeadId}
// KEYS[2] = mailbox:load:{oldMailboxId}:{date}
// KEYS[3] = mailbox:load:{newMailboxId}:{date}
// ARGV[1] = expected current assigned_mailbox_id (guard)
// ARGV[2] = new assignment JSON string
// ARGV[3] = assignment TTL (seconds)
// ARGV[4] = pub/sub channel
// ARGV[5] = pub/sub event JSON
//
// Returns: 1 = success, 0 = guard mismatch (already reassigned), -1 = lead not found
export const ATOMIC_REASSIGN = `
local current = redis.call('GET', KEYS[1])
if current == false then
  return -1
end

local data = cjson.decode(current)
if ARGV[1] ~= '' and data['assigned_mailbox_id'] ~= ARGV[1] then
  return 0
end

redis.call('SETEX', KEYS[1], tonumber(ARGV[3]), ARGV[2])

if KEYS[2] ~= '' and KEYS[2] ~= KEYS[3] then
  redis.call('DECR', KEYS[2])
end
redis.call('INCR', KEYS[3])
redis.call('EXPIRE', KEYS[3], 90000)

if ARGV[4] ~= '' then
  redis.call('PUBLISH', ARGV[4], ARGV[5])
end

return 1
`;

// ─── ATOMIC_BATCH_ASSIGN ──────────────────────────────────────────────────────
// Assign multiple leads to a mailbox in one atomic script.
// Used for initial bulk assignment where race conditions matter least —
// but still ensures mailbox load counter stays accurate.
//
// KEYS[1]     = mailbox:load:{mailboxId}:{date}
// ARGV[1]     = TTL for load key
// ARGV[2..N]  = alternating: leadKey, assignmentJSON, assignmentTTL
//
// Returns: number of leads assigned
export const ATOMIC_BATCH_ASSIGN = `
local count = 0
local i = 2
while i <= #ARGV do
  local key  = ARGV[i]
  local val  = ARGV[i+1]
  local ttl  = tonumber(ARGV[i+2])
  redis.call('SETEX', key, ttl, val)
  redis.call('INCR', KEYS[1])
  count = count + 1
  i = i + 3
end
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
return count
`;

// ─── ATOMIC_MAILBOX_STATE_UPSERT ─────────────────────────────────────────────
// Write mailbox state hash and set TTL atomically.
// KEYS[1] = mailbox:{mailboxId}
// ARGV[1] = TTL (seconds)
// ARGV[2..N] = alternating field, value pairs
//
// Returns: 1
export const ATOMIC_MAILBOX_STATE_UPSERT = `
local key = KEYS[1]
local ttl = tonumber(ARGV[1])
local i = 2
while i <= #ARGV do
  redis.call('HSET', key, ARGV[i], ARGV[i+1])
  i = i + 2
end
redis.call('EXPIRE', key, ttl)
return 1
`;

// ─── ATOMIC_CLAIM_LEAD ────────────────────────────────────────────────────────
// Claim a lead for processing with an idempotency lock.
// Returns 1 if lock acquired, 0 if already locked.
//
// KEYS[1] = routing:lock:{campaignLeadId}
// ARGV[1] = lock TTL (seconds)
// ARGV[2] = worker ID (for debugging)
export const ATOMIC_CLAIM_LEAD = `
local result = redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[1]), 'NX')
if result == false then
  return 0
end
return 1
`;

// ─── PROVIDER_CACHE_GET_OR_LOCK ───────────────────────────────────────────────
// Get cached provider OR acquire a lookup lock (prevents thundering herd on MX).
// If provider is cached: returns {status='hit', family=<value>}
// If not cached but lock acquired: returns {status='locked'}
// If not cached and lock not acquired: returns {status='wait'}
//
// KEYS[1] = provider:{domain}
// KEYS[2] = provider:lock:{domain}
// ARGV[1] = lock TTL (seconds, short — e.g. 10)
export const PROVIDER_CACHE_GET_OR_LOCK = `
local cached = redis.call('GET', KEYS[1])
if cached ~= false then
  return {'hit', cached}
end
local locked = redis.call('SET', KEYS[2], '1', 'EX', tonumber(ARGV[1]), 'NX')
if locked ~= false then
  return {'locked', ''}
end
return {'wait', ''}
`;
