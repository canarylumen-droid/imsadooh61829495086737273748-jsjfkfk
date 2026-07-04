local kumo = require 'kumo'

kumo.start_esmtp_listener {
  listen = '0.0.0.0:2525',
  trusted_hosts = { '127.0.0.1', '::1' },
}

kumo.start_http_listener {
  listen = '127.0.0.1:8000',
  trusted_hosts = { '127.0.0.1', '::1' },
}

kumo.on('smtp_receive_message', function(msg)
  local integration_id = msg:headers():get('X-Integration-Id')
  if integration_id then
    msg:set_meta('integration_id', integration_id)
  end
  return msg
end)
