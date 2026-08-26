/** Object containing internal state constants and handle type constants. */
declare const constants: {
  state: {
    CONNECTING: number
    CONNECTED: number
    BINDING: number
    BOUND: number
    READING: number
    CLOSING: number
    CLOSED: number
    UNREFED: number
    READABLE: number
    WRITABLE: number
  }
  path: {
    MAX_LENGTH: number
  }
  handle: {
    NAMED_PIPE: number
    TCP: number
    UDP: number
  }
}

export = constants
