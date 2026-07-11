local kumo = require 'kumo'

kumo.start_esmtp_listener {
  listen = '0.0.0.0:2525',
}
