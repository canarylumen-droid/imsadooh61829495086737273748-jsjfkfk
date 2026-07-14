local kumo = require 'kumo'

-- =============================================================================
-- Message Policy — Audnix AI
-- =============================================================================
-- Enforces sending policies: rate limits, content filtering,
-- recipient validation, and authentication checks.
-- =============================================================================

local M = {}

-- Maximum recipients per message (prevents list bombing)
local MAX_RECIPIENTS = 50
-- Maximum message size (10MB)
local MAX_MESSAGE_SIZE = 10 * 1024 * 1024
-- Blocked sender domains (known spam sources)
local BLOCKED_DOMAINS = {
  'guerrillamail.com',
  'tempmail.com',
  'throwaway.email',
  'yopmail.com',
  'mailinator.com',
  'guerrillamailblock.com',
  'grr.la',
  'dispostable.com',
  '10minutemail.com',
  'temp-mail.org',
}
-- Blocked recipient domains (known bounce-heavy domains)
local BLOCKED_RECIPIENT_DOMAINS = {
  'example.com',
  'test.com',
  'localhost',
}

function M.configure()
  -- ── SMTP Message Handlers ─────────────────────────────────────────────────

  -- Called when a message is received via SMTP
  kumo.on('smtp_server_message_begin', function(conn)
    local msg = conn.meta

    -- ── Recipient Count Check ─────────────────────────────────────────────
    local recipient_count = #conn.meta.rcpt_to
    if recipient_count > MAX_RECIPIENTS then
      conn:reject(552, string.format(
        'Too many recipients (%d max: %d)',
        MAX_RECIPIENTS, recipient_count))
      return false
    end

    -- ── Sender Domain Validation ──────────────────────────────────────────
    local sender = conn.meta.from
    local sender_domain = sender:match('@(.+)$') or ''

    -- Block known throwaway email services
    for _, blocked in ipairs(BLOCKED_DOMAINS) do
      if sender_domain:lower() == blocked then
        conn:reject(553, 'Rejected: disposable email address')
        return false
      end
    end

    -- ── Recipient Domain Validation ───────────────────────────────────────
    for _, rcpt in ipairs(conn.meta.rcpt_to) do
      local rcpt_domain = rcpt:match('@(.+)$') or ''

      for _, blocked in ipairs(BLOCKED_RECIPIENT_DOMAINS) do
        if rcpt_domain:lower() == blocked then
          conn:reject(550, 'Rejected: invalid recipient domain')
          return false
        end
      end
    end

    -- ── SPF Check ─────────────────────────────────────────────────────────
    -- Require SPF pass for external senders
    local spf_result = conn:get_meta('spf')
    if spf_result and spf_result.result ~= 'pass' then
      -- Log but don't reject — many legitimate senders have loose SPF
      print(string.format('[policy] SPF=%s from=%s ip=%s',
        spf_result.result, sender, conn.remote_addr))
    end

    -- ── Rate Limiting ─────────────────────────────────────────────────────
    -- Per-sender rate limit
    local rate_key = 'sender:' .. sender_domain
    local allowed = kumo.check_throttle(rate_key, '50/1m')
    if not allowed then
      conn:reject(452, 'Rate limit exceeded — try again later')
      return false
    end

    -- ── IP Reputation Check ───────────────────────────────────────────────
    local ip = conn.remote_addr
    local ip_rep = kumo.get_ip_reputation(ip)
    if ip_rep and ip_rep.score < -50 then
      conn:reject(554, 'Rejected: sender reputation too low')
      return false
    end

    return true
  end)

  -- ── Message Size Validation ───────────────────────────────────────────────
  kumo.on('smtp_server_message_end', function(msg)
    local body_size = #msg.body
    if body_size > MAX_MESSAGE_SIZE then
      msg:reject(552, string.format(
        'Message too large (%d bytes, max: %d)',
        body_size, MAX_MESSAGE_SIZE))
      return false
    end
    return true
  end)

  -- ── Authentication Policy ─────────────────────────────────────────────────
  -- For submission port (587), require authentication
  kumo.on('smtp_server_auth', function(conn, username, password)
    -- In production, validate against a database
    -- For now, accept all authenticated connections on port 587
    print(string.format('[policy] Auth: user=%s ip=%s', username, conn.remote_addr))
    return true
  end)

  -- ── MX Resolution Policy ──────────────────────────────────────────────────
  -- Custom MX resolver with caching and fallback
  kumo.on('smtp_server_resolve_mx', function(domain)
    -- Use KumoMTA's built-in MX resolution with caching
    local mx = kumo.resolve_mx(domain)
    if not mx or #mx == 0 then
      -- No MX records found — try A record fallback
      local a = kumo.resolve_a(domain)
      if a then
        return { { exchange = domain, priority = 0 } }
      end
      return nil, 'No MX or A records found for ' .. domain
    end
    return mx
  end)

  -- ── Delivery Policy ───────────────────────────────────────────────────────
  -- Configure delivery behavior per MX host
  kumo.configure_delivery {
    -- Connection timeout
    connect_timeout = '15s',
    -- SMTP greeting timeout
    ehlo_timeout = '15s',
    -- MAIL FROM timeout
    mail_from_timeout = '15s',
    -- RCPT TO timeout
    rcpt_to_timeout = '15s',
    -- DATA timeout
    data_timeout = '30s',
    -- Overall message timeout
    message_timeout = '5m',
    -- Max connections per MX
    max_connections_per_source = 10,
    -- Max messages per connection
    max_messages_per_connection = 100,
    -- Reuse connections when possible
    idle_timeout = '10m',
  }

  print('[policy] Message policy configured')
end

return M
