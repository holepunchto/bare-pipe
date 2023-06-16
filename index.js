const { Duplex } = require('streamx')
const binding = require('./binding')

const DEFAULT_READ_BUFFER = 65536

module.exports = class Pipe extends Duplex {
  constructor (opts = {}) {
    super({ mapWritable })

    const {
      readBufferSize = DEFAULT_READ_BUFFER,
      allowHalfOpen = true
    } = opts

    this._pendingOpen = null
    this._pendingWrite = null
    this._pendingFinal = null
    this._pendingDestroy = null

    this._connected = false
    this._reading = false
    this._allowHalfOpen = allowHalfOpen

    this._buffer = Buffer.alloc(readBufferSize)

    this._handle = binding.init(this._buffer, this,
      this._onconnect,
      this._onconnection,
      this._onwrite,
      this._onfinal,
      this._onread,
      this._onclose
    )
  }

  open (file) {
    binding.open(this._handle, file)
    this._connected = true
    return this
  }

  connect (name) {
    binding.connect(this._handle, name)
    return this
  }

  listen (name, backlog = 511, cb) {
    if (typeof backlog === 'function') {
      cb = backlog
      backlog = 511
    }

    if (cb) this.on('connection', cb)
    binding.listen(this._handle, name, backlog)
    return this
  }

  _open (cb) {
    this._pendingOpen = cb
    this._continueOpen(null)
  }

  _read (cb) {
    if (!this._reading) {
      this._reading = true
      binding.resume(this._handle)
    }
    cb(null)
  }

  _writev (datas, cb) {
    this._pendingWrite = cb
    binding.writev(this._handle, datas)
  }

  _final (cb) {
    this._pendingFinal = cb
    binding.end(this._handle)
  }

  _destroy (cb) {
    this._pendingDestroy = cb
    binding.close(this._handle)
  }

  _continueOpen (err) {
    if (!this._connected) return
    if (this._pendingOpen === null) return
    const cb = this._pendingOpen
    this._pendingOpen = null
    cb(err)
  }

  _continueWrite (err) {
    if (this._pendingWrite === null) return
    const cb = this._pendingWrite
    this._pendingWrite = null
    cb(err)
  }

  _continueFinal (err) {
    if (this._pendingFinal === null) return
    const cb = this._pendingFinal
    this._pendingFinal = null
    cb(err)
  }

  _continueDestroy () {
    if (this._pendingDestroy === null) return
    const cb = this._pendingDestroy
    this._pendingDestroy = null
    cb(null)
  }

  _onconnect (err) {
    this._connected = true
    this._continueOpen(err)
  }

  _onconnection (err) {
    if (err) return // TODO: Propagate errors

    const pipe = new Pipe()

    try {
      binding.accept(this._handle, pipe._handle)
      pipe._connected = true
      this.emit('connection', pipe)
    } catch (err) { // TODO: Propagate errors
      pipe.destroy()
    }
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
