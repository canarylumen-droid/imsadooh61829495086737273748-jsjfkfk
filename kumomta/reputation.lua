local kumo = require 'kumo'

-- =============================================================================
-- Reputation System — Audnix AI
-- =============================================================================
-- Manages IP pool reputation, sender score tracking, and bounce-based
-- reputation adjustments. Uses KumoMTA's built-in reputation engine
-- with custom tuning for Audnix's multi-domain sending patterns.
-- =============================================================================

local M = {}

-- Reputation thresholds (configurable via env)
local THRESHOLD_BAD = tonumber(os.getenv('KUMO_REP_BAD_THRESHOLD') or '-10')
local THRESHOLD_GOOD = tonumber(os.getenv('KUMO_REP_GOOD_THRESHOLD') or '10')
local THRESHOLD_EXCELLENT = tonumber(os.getenv('KUMO_REP_EXCELLENT_THRESHOLD') or '50')

-- Pool definitions
local POOLS = {
  excellent = {
    name = 'pool:excellent',
    -- Best IPs, used for high-value sends (demos, trials)
    max_connection_rate = '50/1s',
    max_messages_per_connection = 100,
    idle_timeout = '30m',
  },
  good = {
    name = 'pool:good',
    -- Normal sending pool
    max_connection_rate = '20/1s',
    max_messages_per_connection = 50,
    idle_timeout = '15m',
  },
  warmup = {
    name = 'pool:warmup',
    -- New IPs or IPs recovering from bounces
    max_connection_rate = '5/1s',
    max_messages_per_connection = 20,
    idle_timeout = '10m',
  },
  cold = {
    name = 'pool:cold',
    -- IPs with poor reputation
    max_connection_rate = '1/1s',
    max_messages_per_connection = 5,
    idle_timeout = '5m',
  },
}

function M.configure()
  -- ── Reputation Engine ─────────────────────────────────────────────────────
  -- KumoMTA tracks per-IP reputation based on:
  --   - Bounce rate (hard/soft)
  --   - Complaint rate
  --   - Delivery rate
  --   - Auth result (SPF/DKIM/DMARC pass/fail)

  kumo.configure_throttle {
    -- Global rate limit across all sending
    name = 'global-sending',
    rate = '1000/1s',
    -- Allow burst
    burst = 500,
    max_burst = 1000,
  }

  -- ── IP Pool Selection ─────────────────────────────────────────────────────
  -- Route messages to pools based on sending domain reputation
  kumo.configure_ip_pool {
    pool_name = 'pool:excellent',
    -- IPs with excellent reputation
    source = {
      { name = 'ip-list', data = { '10.0.1.10', '10.0.1.11', '10.0.1.12' } },
    },
  }

  kumo.configure_ip_pool {
    pool_name = 'pool:good',
    source = {
      { name = 'ip-list', data = { '10.0.1.20', '10.0.1.21', '10.0.1.22', '10.0.1.23' } },
    },
  }

  kumo.configure_ip_pool {
    pool_name = 'pool:warmup',
    source = {
      { name = 'ip-list', data = { '10.0.1.30', '10.0.1.31' } },
    },
  }

  kumo.configure_ip_pool {
    pool_name = 'pool:cold',
    source = {
      { name = 'ip-list', data = { '10.0.1.40' } },
    },
  }

  -- ── Reputation Check Handler ──────────────────────────────────────────────
  -- Called before each message is queued
  kumo.on('smtp_server_message_begin', function(conn)
    -- Check sender reputation
    local sender = conn.meta.from
    local domain = sender:match('@(.+)$') or 'unknown'

    -- Look up domain reputation
    local rep = kumo.get_reputation(domain)
    local score = rep and rep.score or 0

    -- Select pool based on reputation
    local pool
    if score >= THRESHOLD_EXCELLENT then
      pool = POOLS.excellent
    elseif score >= THRESHOLD_GOOD then
      pool = POOLS.good
    elseif score >= THRESHOLD_BAD then
      pool = POOLS.warmup
    else
      pool = POOLS.cold
    end

    -- Set the pool for this message
    conn:set_meta('pool', pool.name)

    -- Log reputation decision
    print(string.format('[reputation] %s domain=%s score=%.1f pool=%s',
      conn.serial_num, domain, score, pool.name))
  end)

  -- ── Bounce Handling ───────────────────────────────────────────────────────
  -- Adjust reputation when bounces occur
  kumo.on('smtp_server_message_reject', function(conn, code, msg)
    local sender = conn.meta.from
    local domain = sender:match('@(.+)$') or 'unknown'

    -- Record the rejection
    kumo.track_reputation {
      domain = domain,
      -- Rejections always hurt reputation
      score_delta = -5,
      -- Don't expire this data point quickly
      expiry = '30d',
    }

    print(string.format('[reputation] reject domain=%s code=%s msg=%s',
      domain, code, msg))
  end)

  kumo.on('delivery_status_deferred', function(domain, code, msg, meta)
    -- Soft bounces: small reputation hit
    kumo.track_reputation {
      domain = domain,
      score_delta = -1,
      expiry = '7d',
    }
  end)

  kumo.on('delivery_status_bounced', function(domain, code, msg, meta)
    -- Hard bounces: significant reputation hit
    kumo.track_reputation {
      domain = domain,
      score_delta = -10,
      expiry = '30d',
    }

    print(string.format('[reputation] hard bounce domain=%s code=%s', domain, code))
  end)

  kumo.on('message_delivery', function(domain, code, msg, meta)
    -- Successful delivery: boost reputation
    kumo.track_reputation {
      domain = domain,
      score_delta = 1,
      expiry = '7d',
    }
  end)

  -- ── Complaint Handling ────────────────────────────────────────────────────
  kumo.on('feedback_complaint', function(msg)
    local sender = msg.sender
    local domain = sender:match('@(.+)$') or 'unknown'

    -- Complaints are devastating — big penalty
    kumo.track_reputation {
      domain = domain,
      score_delta = -25,
      expiry = '90d',
    }

    print(string.format('[reputation] complaint domain=%s sender=%s', domain, sender))
  end)

  -- ── Rate Limiting Per Domain ──────────────────────────────────────────────
  -- Prevent any single domain from flooding the queue
  kumo.configure_throttle {
    name = 'per-domain-sending',
    -- Per-domain rate limit
    rate = '100/1s',
    -- Key by sender domain
    key = function(msg)
      return msg.sender_domain or 'unknown'
    end,
  }

  print('[reputation] Reputation engine configured with 4 pools')
end

return M
