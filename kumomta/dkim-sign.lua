local kumo = require 'kumo'
local os = require 'os'

-- =============================================================================
-- DKIM Signing — Audnix AI
-- =============================================================================
-- Signs outbound messages with DKIM signatures.
-- Supports multiple domains with per-domain keys.
-- =============================================================================

local M = {}

function M.configure()
  -- DKIM key directory structure:
  -- /etc/kumomta/dkim/
  --   audnixai/
  --     default.pem    (RSA 2048-bit key)
  --   _domainkey.audnixai.com/
  --     default.pem

  local dkim_key_dir = os.getenv('KUMO_DKIM_KEY_DIR') or '/etc/kumomta/dkim'

  -- Configure DKIM signing for all outbound mail
  kumo.configure_dkim_sign {
    -- Sign all messages
    sign = function(domain, sender, conn, msg)
      -- Determine which domain to sign for
      -- Use the envelope sender domain
      local signing_domain = sender:match('@(.+)$') or domain

      -- Map subdomains to the parent domain's key
      -- e.g., mail.audnixai.com → audnixai.com
      local base_domain = signing_domain:match('[^.]+%.[^.]+$') or signing_domain

      -- Check if we have a DKIM key for this domain
      local key_path = dkim_key_dir .. '/' .. base_domain .. '/default.pem'

      -- Try to read the key
      local f = io.open(key_path, 'r')
      if not f then
        -- No key found — skip signing for this domain
        -- This is normal for subdomains we don't control
        return nil
      end
      f:close()

      -- Return signing configuration
      return {
        domain = base_domain,
        selector = 'default',
        key = key_path,
        -- Use RSA-SHA256 (most compatible)
        algorithm = 'rsa-sha256',
        -- Sign headers required by RFC 6376
        headers = {
          'from',
          'to',
          'cc',
          'subject',
          'date',
          'message-id',
          'mime-version',
          'content-type',
        },
        -- Canonicalization: relaxed/relaxed (permissive, good for forwarded mail)
        body_canonicalization = 'relaxed',
        header_canonicalization = 'relaxed',
        -- SDID (Signing Domain ID) — must match the From: header domain
        sdid = base_domain,
        -- AUID (Agent Unique Identifier)
        auid = '@' .. base_domain,
        -- Body length limit — don't sign entire body for large messages
        body_limit = 102400,
        -- Use L= tag (body length) for compatibility
        use_l_tag = false,
      }
    end,
  }

  -- Configure DKIM verification for inbound
  kumo.configure_dkim_verify {
    -- Trust these root CAs for DKIM key lookups (uses system trust store)
    trust_store = '/etc/ssl/certs/ca-certificates.crt',
    -- Allow unsigned messages (don't reject them)
    allow_unsigned = true,
    -- Log DKIM results for analytics
    log_results = true,
  }

  print('[dkim] DKIM signing configured for domain keys in ' .. dkim_key_dir)
end

return M
