declare const constants: {
  state: {
    CONNECTING: number
    CONNECTED: number
    BINDING: number
    BOUND: number
    READING: number
    CLOSING: number
    READABLE: number
    WRITABLE: number
    UNREFED: number
  }
  handle: {
    NAMED_PIPE: number
    TCP: number
    UDP: number
  }
}

export = constants
