local kumo = require 'kumo'
local policy = require 'policy'
local dkim = require 'dkim-sign'
local reputation = require 'reputation'

-- =============================================================================
-- KumoMTA Init — Audnix AI Mail Infrastructure
-- =============================================================================
-- This is the main entry point for KumoMTA configuration.
-- It sets up listeners, authentication, DKIM signing, and message policies.
-- =============================================================================

-- ── ESMTP Listener ──────────────────────────────────────────────────────────
kumo.start_esmtp_listener {
  listen = '0.0.0.0:25',
  hostname = kumo.optimizing_hostname 'audnixai.com',
  -- TLS is handled at the load balancer / reverse proxy level
  -- Uncomment below if terminating TLS at KumoMTA:
  -- tls = {
  --   certificate = '/etc/kumomta/certs/fullchain.pem',
  --   private_key = '/etc/kumomta/certs/privkey.pem',
  -- },
}

-- Submission listener (port 587) for authenticated sending
kumo.start_esmtp_listener {
  listen = '0.0.0.0:587',
  hostname = kumo.optimizing_hostname 'audnixai.com',
  authz = {
    -- Only allow authenticated users to send via submission
    { method = 'SMTP' },
  },
  tls = {
    certificate = '/etc/kumomta/certs/fullchain.pem',
    private_key = '/etc/kumomta/certs/privkey.pem',
    -- Require STARTTLS on submission port
    require_peer_cert = false,
  },
}

-- Internal listener for local MTA relay (port 2525)
kumo.start_esmtp_listener {
  listen = '0.0.0.0:2525',
  hostname = kumo.optimizing_hostname 'audnixai.com',
}

-- ── Bounce Classification ───────────────────────────────────────────────────
kumo.configure_bounce_classifier {
  sources = {
    -- Custom bounce classifications for Audnix
    {
      name = 'audnix-custom',
      -- Hard bounces: permanently undeliverable
      codes = {
        { code = 550, regex = 'user unknown' },
        { code = 550, regex = 'mailbox not found' },
        { code = 550, regex = 'no such user' },
        { code = 550, regex = 'invalid recipient' },
        { code = 550, regex = 'recipient rejected' },
        { code = 551, regex = 'user not local' },
        { code = 552, regex = 'mailbox full' },  -- treat as hard for reputation
        { code = 553, regex = 'invalid domain' },
        { code = 554, regex = 'transaction failed' },
      },
    },
    -- Soft bounces: temporary failures
    {
      name = 'audnix-temp',
      codes = {
        { code = 421, regex = 'try again later' },
        { code = 451, regex = 'greylisting' },
        { code = 452, regex = 'insufficient storage' },
        { code = 471, regex = 'temporarily deferred' },
      },
    },
  },
}

-- ── DKIM Configuration ──────────────────────────────────────────────────────
dkim.configure()

-- ── Reputation ──────────────────────────────────────────────────────────────
reputation.configure()

-- ── Message Policy ──────────────────────────────────────────────────────────
policy.configure()

-- ── Queue Configuration ─────────────────────────────────────────────────────
kumo.configure_queue {
  -- Default queue settings
  max_retry_interval = '10m',
  max_retries = 15,
  backpressure = '50mb',
  idle_timeout = '10m',
  path = '/var/spool/kumomta',
}

-- ── Logging ─────────────────────────────────────────────────────────────────
kumo.configure_logger {
  -- Log to jlog for analytics
  log_dir = '/var/log/kumomta',
  log_mode = 'imap',
  -- Don't log DKIM keys or auth tokens
  denied_headers = {
    'x-auth-token',
    'authorization',
  },
}

print('[init] KumoMTA configuration loaded successfully')
