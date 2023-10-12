const EventEmitter = require('events')
const { Duplex } = require('streamx')
const binding = require('./binding')

const DEFAULT_READ_BUFFER = 65536

const Pipe = module.exports = class Pipe extends Duplex {
  constructor (path, opts = {}) {
    super({ mapWritable, eagerOpen: true })

    if (typeof path === 'object' && path !== null) {
      opts = path
      path = null
    }

    const {
      readBufferSize = DEFAULT_READ_BUFFER,
      allowHalfOpen = true
    } = opts

    this._pendingOpen = null
    this._pendingWrite = null
    this._pendingFinal = null
    this._pendingDestroy = null

    this._connected = typeof path !== 'string'
    this._reading = false
    this._closing = false
    this._allowHalfOpen = allowHalfOpen

    this._buffer = Buffer.alloc(readBufferSize)

    this._handle = binding.init(this._buffer, this,
      noop,
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

    Pipe._pipes.add(this)
  }

  ref () {
    binding.ref(this._handle)
  }

  unref () {
    binding.unref(this._handle)
  }

  static createServer (opts) {
    return new PipeServer(opts)
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

  _predestroy () {
    if (this._closing) return
    this._closing = true
    binding.close(this._handle)
    Pipe._pipes.delete(this)
  }

  _destroy (cb) {
    if (this._closing) return cb(null)
    this._closing = true
    this._pendingDestroy = cb
    binding.close(this._handle)
    Pipe._pipes.delete(this)
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
    if (!err) this.emit('connect')
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

  static _pipes = new Set()
}

class PipeServer extends EventEmitter {
  constructor (opts = {}) {
    super()

    const {
      readBufferSize = DEFAULT_READ_BUFFER,
      allowHalfOpen = true
    } = opts

    this._readBufferSize = readBufferSize
    this._allowHalfOpen = allowHalfOpen

    this._handle = binding.init(empty, this,
      this._onconnection,
      noop,
      noop,
      noop,
      noop,
      this._onclose
    )

    this.listening = false
    this.closing = false
    this.connections = new Set()

    PipeServer._servers.add(this)
  }

  listen (name, backlog = 511) {
    if (this.listening) throw new Error('Server is already bound')
    if (this.closing) throw new Error('Server is closed')

    binding.bind(this._handle, name, backlog)

    return this
  }

  close (onclose) {
    if (onclose) this.once('close', onclose)

    if (this.closing) return
    this.closing = true
    this._closeMaybe()
  }

  ref () {
    binding.ref(this._handle)
  }

  unref () {
    binding.unref(this._handle)
  }

  _closeMaybe () {
    if (this.closing && this.connections.size === 0) {
      binding.close(this._handle)
      PipeServer._servers.delete(this)
    }
  }

  _onconnection (err) {
    if (err) {
      this.emit('error', err)
      return
    }

    if (this.closing) return

    const pipe = new Pipe({
      readBufferSize: this._readBufferSize,
      allowHalfOpen: this._allowHalfOpen
    })

    try {
      binding.accept(this._handle, pipe._handle)

      this.connections.add(pipe)

      pipe.on('close', () => {
        this.connections.delete(pipe)
        this._closeMaybe()
      })

      this.emit('connection', pipe)
    } catch (err) {
      this.emit('error', err)
      pipe.destroy()
    }
  }

  _onclose () {
    this._handle = null
    this.emit('close')
  }

  static _servers = new Set()
}

process
  .on('exit', () => {
    for (const pipe of Pipe._pipes) {
      pipe.destroy()
    }

    for (const server of PipeServer._servers) {
      server.close()
    }
  })

const empty = Buffer.alloc(0)

function noop () {}

function mapWritable (buf) {
  return typeof buf === 'string' ? Buffer.from(buf) : buf
}
