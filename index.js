const { Duplex } = require('streamx')
const binding = require('./binding')

const DEFAULT_READ_BUFFER = 65536

module.exports = class Pipe extends Duplex {
  constructor (path, opts = {}) {
    super({ mapWritable })

    if (typeof path === 'object' && path !== null) {
      opts = path
      path = null
    }

    const {
      readBufferSize = DEFAULT_READ_BUFFER,
      allowHalfOpen = true
    } = opts

    const slab = Buffer.alloc(binding.sizeofPipe + binding.sizeofWrite + readBufferSize)

    this._handle = slab.subarray(0, binding.sizeofPipe)
    this._req = slab.subarray(binding.sizeofPipe, binding.sizeofPipe + binding.sizeofWrite)
    this._buffer = slab.subarray(binding.sizeofPipe + binding.sizeofWrite)

    this._openCallback = null
    this._writeCallback = null
    this._finalCallback = null
    this._destroyCallback = null

    this._connected = typeof path === 'string' ? 0 : 1
    this._reading = false
    this._allowHalfOpen = allowHalfOpen

    binding.init(this._handle, this._buffer, this,
      this._onconnect,
      this._onwrite,
      this._onfinal,
      this._onread,
      this._onclose
    )

    if (typeof path === 'number') {
      binding.open(this._handle, path)
    } else if (typeof path === 'string') {
      binding.connect(this._handle, path)
    }
  }

  _open (cb) {
    this._openCallback = cb
    this._continueOpen()
  }

  _read (cb) {
    if (!this._reading) {
      this._reading = true
      binding.resume(this._handle)
    }
    cb(null)
  }

  _writev (datas, cb) {
    this._writeCallback = cb
    binding.writev(this._req, this._handle, datas)
  }

  _final (cb) {
    this._finalCallback = cb
    binding.end(this._handle)
  }

  _destroy (cb) {
    this._destroyCallback = cb
    binding.close(this._handle)
  }

  _continueOpen () {
    if (this._connected === 0) return
    if (this._openCallback === null) return
    const cb = this._openCallback
    this._openCallback = null
    cb(this._connected < 0 ? makeError(this._connected) : null)
  }

  _continueWrite (err) {
    if (this._writeCallback === null) return
    const cb = this._writeCallback
    this._writeCallback = null
    cb(err)
  }

  _continueFinal (err) {
    if (this._finalCallback === null) return
    const cb = this._finalCallback
    this._finalCallback = null
    cb(err)
  }

  _continueDestroy () {
    if (this._destroyCallback === null) return
    const cb = this._destroyCallback
    this._destroyCallback = null
    cb(null)
  }

  _onconnect (status) {
    this._connected = status < 0 ? status : 1
    this._continueOpen()
  }

  _onwrite (status) {
    const err = status < 0 ? makeError(status) : null
    this._continueWrite(err)
  }

  _onread (read) {
    if (read === 0) {
      this.push(null)
      if (this._allowHalfOpen === false) this.end()
      return
    }

    if (read < 0) {
      this.destroy(makeError(read))
      return
    }

    const copy = Buffer.allocUnsafe(read)
    copy.set(this._buffer.subarray(0, read))

    if (this.push(copy) === false && this.destroying === false) {
      this._reading = false
      binding.pause(this._handle)
    }
  }

  _onfinal (status) {
    const err = status < 0 ? makeError(status) : null
    this._continueFinal(err)
  }

  _onclose () {
    this._handle = null
    this._continueDestroy()
  }
}

function mapWritable (buf) {
  return typeof buf === 'string' ? Buffer.from(buf) : buf
}

function makeError (errno) {
  const [code, msg] = process.errnos.get(errno)
  const err = new Error(code + ': ' + msg)

  err.code = code
  err.errno = errno

  return err
}
