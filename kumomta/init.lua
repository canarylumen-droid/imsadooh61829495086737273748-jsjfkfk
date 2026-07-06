local kumo = require 'kumo'

kumo.start_esmtp_listener {
  listen = '0.0.0.0:2525',
  trusted_hosts = { '127.0.0.1', '::1' },
}

kumo.start_http_listener {
  listen = '127.0.0.1:8000',
  trusted_hosts = { '127.0.0.1', '::1' },
}

-- Redis client for reputation checks
local redis = require 'redis'
local client = redis.connect(os.getenv('REDIS_URL') or 'redis://127.0.0.1:6379')

kumo.on('smtp_receive_message', function(msg)
  -- Extract integration ID from header
  local integration_id = msg:headers():get('X-Integration-Id')
  if integration_id then
    msg:set_meta('integration_id', integration_id)

    -- Reputation guard: check if this mailbox is paused
    local paused = client:get('rep:paused:' .. integration_id)
    if paused == 'true' then
      msg:set_meta('should_queue', 'true')
      kumo.log('warn', 'Reputation guard: queued message for ' .. integration_id)
    end
  end
  return msg
end)
