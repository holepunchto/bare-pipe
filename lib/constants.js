const binding = require('../binding')

module.exports = {
  state: {
    CONNECTING: 0x1,
    CONNECTED: 0x2,
    BINDING: 0x4,
    BOUND: 0x8,
    READING: 0x10,
    CLOSING: 0x20,
    CLOSED: 0x40,
    UNREFED: 0x80,
    READABLE: 0x100,
    WRITABLE: 0x200
  },
  path: {
    MAX_LENGTH: binding.MAX_PATH_LENGTH
  },
  handle: {
    NAMED_PIPE: binding.UV_NAMED_PIPE,
    TCP: binding.UV_TCP,
    UDP: binding.UV_UDP
  }
}
