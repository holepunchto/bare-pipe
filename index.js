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

    this._connected = typeof path !== 'string'
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
    this._continueOpen(null)
  }

  _read (cb) {
    if (!this._reading) {
      this._reading = true
      console.log('resume')
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
    console.log('final')
    binding.end(this._handle)
  }

  _destroy (cb) {
    console.log('close')
    this._destroyCallback = cb
    binding.close(this._handle)
  }

  _continueOpen (err) {
    if (!this._connected) return
    if (this._openCallback === null) return
    const cb = this._openCallback
    this._openCallback = null
    cb(err)
  }

  _continueWrite (err) {
    if (this._writeCallback === null) return
    const cb = this._writeCallback
    this._writeCallback = null
    cb(err)
  }

  _continueFinal (err) {
    if (this._finalCallback === null) return
      console.log('continue final')
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

  _onconnect (err) {
    this._connected = true
    this._continueOpen(err)
  }

  _onwrite (err) {
    this._continueWrite(err)
  }

  _onread (err, read) {
    if (err) {
      this.destroy(err)
      return
    }

    if (read === 0) {
      this.push(null)
      if (this._allowHalfOpen === false) this.end()
      return
    }

    const copy = Buffer.allocUnsafe(read)
    copy.set(this._buffer.subarray(0, read))

    if (this.push(copy) === false && this.destroying === false) {
      this._reading = false
      binding.pause(this._handle)
    }
  }

  _onfinal (err) {
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
