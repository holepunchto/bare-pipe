module.exports = class PipeError extends Error {
  constructor (msg, code, fn = PipeError) {
    super(`${code}: ${msg}`)
    this.code = code

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, fn)
    }
  }

  get name () {
    return 'PipeError'
  }

  static SERVER_IS_CLOSED (msg) {
    return new PipeError(msg, 'SERVER_IS_CLOSED', PipeError.SERVER_IS_CLOSED)
  }
}
