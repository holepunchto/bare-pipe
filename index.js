/* global Bare */
const EventEmitter = require('bare-events')
const { Duplex } = require('streamx')
const binding = require('./binding')
const constants = require('./lib/constants')
const errors = require('./lib/errors')

const defaultReadBufferSize = 65536

const Pipe = module.exports = exports = class Pipe extends Duplex {
  constructor (path, opts = {}) {
    super({ mapWritable, eagerOpen: true })

    if (typeof path === 'object' && path !== null) {
      opts = path
      path = null
    }

    const {
      readBufferSize = defaultReadBufferSize,
      allowHalfOpen = true
    } = opts

    this._state = typeof path === 'string' ? constants.state.CONNECTING : constants.state.CONNECTED

    this._allowHalfOpen = allowHalfOpen

    this._pendingOpen = null
    this._pendingWrite = null
    this._pendingFinal = null
    this._pendingDestroy = null

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

  get connecting () {
    return (this._state & constants.state.CONNECTING) !== 0
  }

  get pending () {
    return (this._state & constants.state.CONNECTED) === 0
  }

  ref () {
    binding.ref(this._handle)
  }

  unref () {
    binding.unref(this._handle)
  }

  _open (cb) {
    if (this._state & constants.state.CONNECTED) return cb(null)
    this._pendingOpen = cb
  }

  _read (cb) {
    if ((this._state & constants.state.READING) === 0) {
      this._state |= constants.state.READING
      binding.resume(this._handle)
    }

    cb(null)
  }

  _writev (datas, cb) {
    this._pendingWrite = [cb, datas]
    binding.writev(this._handle, datas)
  }

  _final (cb) {
    this._pendingFinal = cb
    binding.end(this._handle)
  }

  _predestroy () {
    if (this._state & constants.state.CLOSING) return
    this._state |= constants.state.CLOSING
    binding.close(this._handle)
    Pipe._pipes.delete(this)
  }

  _destroy (cb) {
    if (this._state & constants.state.CLOSING) return cb(null)
    this._state |= constants.state.CLOSING
    this._pendingDestroy = cb
    binding.close(this._handle)
    Pipe._pipes.delete(this)
  }

  _continueOpen (err) {
    if (this._pendingOpen === null) return
    const cb = this._pendingOpen
    this._pendingOpen = null
    cb(err)
  }

  _continueWrite (err) {
    if (this._pendingWrite === null) return
    const cb = this._pendingWrite[0]
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
    if (err) {
      this.destroy(err)
      return
    }

    this._state |= constants.state.CONNECTED
    this._state &= ~constants.state.CONNECTING
    this._continueOpen()

    this.emit('connect')
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
      this._state &= ~constants.state.READING
      binding.pause(this._handle)
    }
  }

  _onwrite (err) {
    this._continueWrite(err)
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

exports.createServer = function createServer (opts) {
  return new PipeServer(opts)
}

class PipeServer extends EventEmitter {
  constructor (opts = {}, onconnection) {
    if (typeof opts === 'function') {
      onconnection = opts
      opts = {}
    }

    super()

    const {
      readBufferSize = defaultReadBufferSize,
      allowHalfOpen = true
    } = opts

    this._state = 0

    this._readBufferSize = readBufferSize
    this._allowHalfOpen = allowHalfOpen

    this._connections = new Set()

    this._handle = binding.init(empty, this,
      this._onconnection,
      noop,
      noop,
      noop,
      noop,
      this._onclose
    )

    if (onconnection) this.on('connection', onconnection)

    PipeServer._servers.add(this)
  }

  get listening () {
    return (this._state & constants.state.LISTENING) !== 0
  }

  listen (name, backlog = 511, onlistening) {
    if (this._state & constants.state.CLOSING) {
      throw errors.SERVER_IS_CLOSED('Server is closed')
    }

    if (typeof backlog === 'function') {
      onlistening = backlog
      backlog = 511
    }

    try {
      binding.bind(this._handle, name, backlog)

      this._state |= constants.state.LISTENING

      if (onlistening) this.once('listening', onlistening)

      queueMicrotask(() => this.emit('listening'))
    } catch (err) {
      queueMicrotask(() => {
        if ((this._state & constants.state.CLOSING) === 0) this.emit('error', err)
      })
    }

    return this
  }

  close (onclose) {
    if (onclose) this.once('close', onclose)
    if (this._state & constants.state.CLOSING) return
    this._state |= constants.state.CLOSING
    this._closeMaybe()
  }

  ref () {
    binding.ref(this._handle)
  }

  unref () {
    binding.unref(this._handle)
  }

  _closeMaybe () {
    if ((this._state & constants.state.CLOSING) && this._connections.size === 0) {
      binding.close(this._handle)
      PipeServer._servers.delete(this)
    }
  }

  _onconnection (err) {
    if (err) {
      this.emit('error', err)
      return
    }

    if (this._state & constants.state.CLOSING) return

    const pipe = new Pipe({
      readBufferSize: this._readBufferSize,
      allowHalfOpen: this._allowHalfOpen
    })

    try {
      binding.accept(this._handle, pipe._handle)

      pipe._state |= constants.state.CONNECTED

      this._connections.add(pipe)

      pipe.on('close', () => {
        this._connections.delete(pipe)
        this._closeMaybe()
      })

      this.emit('connection', pipe)
    } catch (err) {
      pipe.destroy()

      throw err
    }
  }

  _onclose () {
    this._handle = null
    this.emit('close')
  }

  static _servers = new Set()
}

Bare
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
