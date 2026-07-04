local redis = require 'redis'
local client = redis.connect(os.getenv('REDIS_URL') or 'redis://127.0.0.1:6379')

function kumo.on('smtp_receive_message', function(msg)
  local integration_id = msg:meta().integration_id
  if not integration_id then
    integration_id = msg:headers():get('X-Integration-Id')
  end
  if integration_id then
    msg:set_meta('integration_id', integration_id)
    local paused = client:get('rep:paused:' .. integration_id)
    if paused == 'true' then
      msg:set_meta('should_queue', 'true')
      kumo.log('warn', 'Reputation guard: queued message for ' .. integration_id)
    end
  end
  return msg
end)
