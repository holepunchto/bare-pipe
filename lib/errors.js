module.exports = class PipeError extends Error {
  constructor(msg, fn = PipeError, code = fn.name) {
    super(`${code}: ${msg}`)
    this.code = code

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, fn)
    }
  }

  get name() {
    return 'PipeError'
  }

  static PIPE_ALREADY_CONNECTED(msg) {
    return new PipeError(msg, PipeError.PIPE_ALREADY_CONNECTED)
  }

  static PIPE_IS_CLOSED(msg) {
    return new PipeError(msg, PipeError.PIPE_IS_CLOSED)
  }

  static SERVER_ALREADY_LISTENING(msg) {
    return new PipeError(msg, PipeError.SERVER_ALREADY_LISTENING)
  }

  static SERVER_IS_CLOSED(msg) {
    return new PipeError(msg, PipeError.SERVER_IS_CLOSED)
  }

  static INVALID_ARGUMENT(msg) {
    return new PipeError(msg, PipeError.INVALID_ARGUMENT)
  }

  static INVALID_FD(msg) {
    return new PipeError(msg, PipeError.INVALID_FD)
  }

  static INVALID_IPC_TARGET(msg) {
    return new PipeError(msg, PipeError.INVALID_IPC_TARGET)
  }

  static INVALID_PATH(msg) {
    return new PipeError(msg, PipeError.INVALID_PATH)
  }
}
