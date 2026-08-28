const EventEmitter = require('bare-events')
const { Duplex, isFinished, isReadable, isWritable } = require('bare-stream')
const binding = require('./binding')
const constants = require('./lib/constants')
const errors = require('./lib/errors')

const defaultReadBufferSize = 65536
const empty = Buffer.alloc(0)

const ipcHandle = Symbol.for('bare.ipc.handle')
const ipcAccept = Symbol.for('bare.ipc.accept')

module.exports = exports = class Pipe extends Duplex {
  constructor(path, opts = {}) {
    if (typeof path === 'object' && path !== null) {
      opts = path
      path = null
    }

    const {
      readBufferSize = defaultReadBufferSize,
      allowHalfOpen = true,
      eagerOpen = true,
      ipc = false
    } = opts

    validateInteger(readBufferSize, 'Read buffer size', 1, 0x7fffffff)

    super({ eagerOpen: !!eagerOpen })

    this._state = 0

    this._allowHalfOpen = !!allowHalfOpen
    this._ipc = !!ipc

    this._fd = -1
    this._path = null

    this._error = null

    this._pendingOpen = null
    this._pendingWrite = null
    this._pendingWriteBatch = null
    this._pendingWriteSegments = null
    this._pendingWriteIdx = 0
    this._pendingFinal = null
    this._pendingDestroy = null

    this._handleQueue = []
    this._handleQueueSize = 0

    this._buffer = Buffer.alloc(readBufferSize)

    this._handle = binding.init(
      this._buffer,
      this._ipc,
      this,
      noop,
      this._onconnect,
      this._onread,
      this._onwrite,
      this._onfinal,
      this._onhandle,
      this._onclose
    )

    if (typeof path === 'number') {
      this.open(path)
    } else if (typeof path === 'string') {
      this.connect(path)
    }
  }

  get connecting() {
    return (this._state & constants.state.CONNECTING) !== 0
  }

  get pending() {
    if (this._state & (constants.state.CLOSING | constants.state.CLOSED)) return true

    return (this._state & constants.state.CONNECTED) === 0
  }

  get readyState() {
    if (this._state & constants.state.CONNECTING) return 'opening'

    if (this._state & constants.state.CONNECTED) {
      const readable = (this._state & constants.state.READABLE) !== 0 && isReadable(this)
      const writable =
        (this._state & constants.state.WRITABLE) !== 0 && isWritable(this) && !isFinished(this)

      if (readable && writable) return 'open'
      if (readable) return 'readOnly'
      if (writable) return 'writeOnly'
    }

    return 'closed'
  }

  get [ipcHandle]() {
    return this._handle
  }

  connect(path, opts = {}, onconnect) {
    if ((this._state & constants.state.CLOSING) !== 0 || this._error !== null) {
      throw errors.PIPE_IS_CLOSED('Pipe is closed')
    }

    if (this._state & (constants.state.CONNECTING | constants.state.CONNECTED)) {
      throw errors.PIPE_ALREADY_CONNECTED('Pipe is already connected')
    }

    if (typeof opts === 'function') {
      onconnect = opts
      opts = {}
    }

    if (typeof path === 'object' && path !== null) {
      opts = path
      path = opts.path
    }

    validatePath(path)

    this._state |= constants.state.CONNECTING

    try {
      binding.connect(this._handle, path)

      this._path = path

      if (onconnect) this.once('connect', onconnect)
    } catch (err) {
      queueMicrotask(() => this._failConnect(err))
    }

    return this
  }

  open(fd, opts = {}, onconnect) {
    if ((this._state & constants.state.CLOSING) !== 0 || this._error !== null) {
      throw errors.PIPE_IS_CLOSED('Pipe is closed')
    }

    if (this._state & (constants.state.CONNECTING | constants.state.CONNECTED)) {
      throw errors.PIPE_ALREADY_CONNECTED('Pipe is already connected')
    }

    if (typeof opts === 'function') {
      onconnect = opts
      opts = {}
    }

    if (typeof fd === 'object' && fd !== null) {
      opts = fd
      fd = opts.fd
    }

    validateFd(fd)

    try {
      const status = binding.open(this._handle, fd)

      this._fd = fd

      this._state |= constants.state.CONNECTED

      if (status & binding.READABLE) {
        this._state |= constants.state.READABLE
      } else {
        this.push(null)
      }

      if (status & binding.WRITABLE) {
        this._state |= constants.state.WRITABLE
      } else {
        this.end()
      }

      if (onconnect) this.once('connect', onconnect)
    } catch (err) {
      this._error = err

      queueMicrotask(() => {
        if (this._pendingOpen) this._continueOpen(err)
        else this.destroy(err)
      })

      return this
    }

    this._continueOpen()

    queueMicrotask(() => {
      if (this._state & constants.state.CLOSING) return

      this.emit('connect')
    })

    return this
  }

  write(chunk, encoding, handle, cb) {
    if (typeof encoding === 'function') {
      cb = encoding
      encoding = undefined
      handle = null
    } else if (typeof encoding === 'object' && encoding !== null) {
      if (typeof handle === 'function') cb = handle
      handle = encoding
      encoding = undefined
    } else if (typeof handle === 'function') {
      cb = handle
      handle = null
    }

    if (handle) toIPCHandle(handle)

    if ((this._state & constants.state.CLOSING) === 0) {
      if (handle) this._handleQueueSize++

      this._handleQueue.push(handle || null)
    }

    if (encoding) return super.write(chunk, encoding, cb)

    return super.write(chunk, cb)
  }

  accept(target) {
    const handle = toIPCHandle(target)

    binding.accept(this._handle, handle)

    if (typeof target[ipcAccept] === 'function') target[ipcAccept]()

    return target
  }

  ref() {
    this._state &= ~constants.state.UNREFED

    if (this._state & constants.state.CLOSING) return this

    binding.ref(this._handle)

    return this
  }

  unref() {
    this._state |= constants.state.UNREFED

    if (this._state & constants.state.CLOSING) return this

    binding.unref(this._handle)

    return this
  }

  [ipcAccept]() {
    this._onaccept()
  }

  _open(cb) {
    if (this._state & constants.state.CONNECTED) return cb(null)

    this._pendingOpen = cb
  }

  _read() {
    if ((this._state & constants.state.READING) === 0) {
      this._state |= constants.state.READING

      binding.resume(this._handle)
    }
  }

  _writev(batch, cb) {
    this._pendingWrite = cb
    this._pendingWriteBatch = batch

    try {
      coerceBatch(batch)
    } catch (err) {
      return this._continueWrite(err)
    }

    if (this._handleQueueSize === 0) {
      this._handleQueue = []
      this._pendingWriteSegments = null

      try {
        binding.writev(
          this._handle,
          batch.map(({ chunk }) => chunk),
          null
        )
      } catch (err) {
        this._continueWrite(err)
      }

      return
    }

    const handles = this._handleQueue.splice(0, batch.length)

    // Fill any holes in the batch for messages that don't carry a handle. Each
    // message that does carry a handle decrements the handle queue size.
    for (let i = 0; i < batch.length; i++) {
      if (handles[i] === undefined) handles[i] = null
      else if (handles[i] !== null) this._handleQueueSize--
    }

    // A handle rides along with a single write, so the batch is split into runs
    // of handleless messages and one message per handle.
    const segments = []

    let i = 0
    while (i < batch.length) {
      if (handles[i] !== null) {
        segments.push({ chunks: [batch[i]], handle: handles[i] })
        i++
      } else {
        const start = i
        while (i < batch.length && handles[i] === null) i++
        segments.push({ chunks: batch.slice(start, i), handle: null })
      }
    }

    this._pendingWriteSegments = segments
    this._pendingWriteIdx = 0

    this._writeNextSegment()
  }

  _writeNextSegment() {
    const segment = this._pendingWriteSegments[this._pendingWriteIdx]

    const chunks = []
    for (let i = 0; i < segment.chunks.length; i++) {
      chunks.push(segment.chunks[i].chunk)
    }

    let sendHandle = null

    try {
      // The target was checked when the write was queued, but it may have been
      // invalidated since.
      if (segment.handle !== null) sendHandle = toIPCHandle(segment.handle)

      binding.writev(this._handle, chunks, sendHandle)
    } catch (err) {
      this._continueWrite(err)
    }
  }

  _final(cb) {
    const duplex = constants.state.READABLE | constants.state.WRITABLE

    if ((this._state & duplex) !== duplex) return cb(null)

    this._pendingFinal = cb

    try {
      binding.end(this._handle)
    } catch (err) {
      this._continueFinal(err.code === 'ENOTCONN' ? null : err)
    }
  }

  _predestroy() {
    if (this._state & constants.state.CLOSING) return
    this._state |= constants.state.CLOSING
    this._state &= ~constants.state.CONNECTING

    this._clearHandleQueue()

    binding.close(this._handle)
  }

  _destroy(err, cb) {
    if (this._state & constants.state.CLOSED) return cb(err)

    this._pendingDestroy = cb

    if (this._state & constants.state.CLOSING) return
    this._state |= constants.state.CLOSING
    this._state &= ~constants.state.CONNECTING

    this._clearHandleQueue()

    binding.close(this._handle)
  }

  _clearHandleQueue() {
    this._handleQueue = []
    this._handleQueueSize = 0
  }

  _continueOpen(err) {
    if (this._pendingOpen === null) return
    const cb = this._pendingOpen
    this._pendingOpen = null
    cb(err)
  }

  _continueWrite(err) {
    if (this._pendingWrite === null) return

    // A batch that carries handles is written one segment at a time, so it only
    // settles once the last segment has been written or one of them failed.
    if (this._pendingWriteSegments !== null) {
      this._pendingWriteIdx++

      if (err === null && this._pendingWriteIdx < this._pendingWriteSegments.length) {
        return this._writeNextSegment()
      }
    }

    const cb = this._pendingWrite
    this._pendingWrite = null
    this._pendingWriteBatch = null
    this._pendingWriteSegments = null
    this._pendingWriteIdx = 0
    cb(err)
  }

  _continueFinal(err) {
    if (this._pendingFinal === null) return
    const cb = this._pendingFinal
    this._pendingFinal = null
    cb(err)
  }

  _continueDestroy() {
    if (this._pendingDestroy === null) return
    const cb = this._pendingDestroy
    this._pendingDestroy = null
    cb(null)
  }

  _failConnect(err) {
    if (this._state & constants.state.CLOSING) return

    this._state &= ~constants.state.CONNECTING

    if (this._pendingOpen) this._continueOpen(err)
    else this.destroy(err)
  }

  _onconnect(err) {
    if (err) {
      this._failConnect(err)
      return
    }

    this._state |= constants.state.CONNECTED | constants.state.READABLE | constants.state.WRITABLE
    this._state &= ~constants.state.CONNECTING

    this._continueOpen()

    this.emit('connect')
  }

  _onaccept() {
    this._state |= constants.state.CONNECTED | constants.state.READABLE | constants.state.WRITABLE

    this._continueOpen()
  }

  _onread(err, read) {
    if (err) {
      this.destroy(err)
      return
    }

    if (read === 0) {
      this.push(null)
      if (this._allowHalfOpen === false) this.end()
      return
    }

    // Unpooled, as a read too small to be given a buffer of its own would
    // otherwise pin the whole pool it came from for as long as its consumer
    // holds on to it.
    const copy = Buffer.allocUnsafeSlow(read)
    copy.set(this._buffer.subarray(0, read))

    if (this.push(copy) === false && this.destroying === false) {
      this._state &= ~constants.state.READING

      binding.pause(this._handle)
    }
  }

  _onwrite(err) {
    this._continueWrite(err)
  }

  _onfinal() {
    this._continueFinal(null)
  }

  _onhandle(type) {
    this.emit('handle', type)
  }

  _onclose() {
    this._state |= constants.state.CLOSED

    this._continueOpen()
    this._continueDestroy()
  }

  _onspawn(readable, writable) {
    this._state |= constants.state.CONNECTED

    if (readable) {
      this._state |= constants.state.READABLE
    } else {
      this.push(null)
    }

    if (writable) {
      this._state |= constants.state.WRITABLE
    } else {
      this.end()
    }

    this._continueOpen()
  }
}

exports.Pipe = exports

exports.Server = class PipeServer extends EventEmitter {
  constructor(opts = {}, onconnection) {
    if (typeof opts === 'function') {
      onconnection = opts
      opts = {}
    }

    super()

    const {
      readBufferSize = defaultReadBufferSize,
      allowHalfOpen = true,
      pauseOnConnect = false,
      ipc = false
    } = opts

    validateInteger(readBufferSize, 'Read buffer size', 1, 0x7fffffff)

    this._state = 0

    this._readBufferSize = readBufferSize
    this._allowHalfOpen = !!allowHalfOpen
    this._pauseOnConnect = !!pauseOnConnect
    this._ipc = !!ipc

    this._path = null
    this._connections = new Set()

    this._error = null
    this._handle = null

    if (onconnection) this.on('connection', onconnection)
  }

  get listening() {
    return (this._state & constants.state.BOUND) !== 0
  }

  get closing() {
    return (this._state & constants.state.CLOSING) !== 0
  }

  address() {
    if ((this._state & constants.state.BOUND) === 0) return null

    return this._path
  }

  listen(path, backlog = 511, opts = {}, onlistening) {
    if (this._state & constants.state.CLOSING) {
      throw errors.SERVER_IS_CLOSED('Server is closed')
    }

    if (this._state & (constants.state.BINDING | constants.state.BOUND)) {
      throw errors.SERVER_ALREADY_LISTENING('Server is already listening')
    }

    if (typeof backlog === 'function') {
      onlistening = backlog
      backlog = 511
    } else if (typeof opts === 'function') {
      onlistening = opts
      opts = {}
    }

    if (typeof path === 'object' && path !== null) {
      opts = path
      path = opts.path
      backlog = defaultTo(opts.backlog, 511)
    }

    if (backlog === null || backlog === 0) backlog = 511

    validatePath(path)
    validateInteger(backlog, 'Backlog', 0, 0x7fffffff)

    this._state |= constants.state.BINDING
    this._state &= ~constants.state.CLOSED

    this._handle = binding.init(
      empty,
      this._ipc,
      this,
      this._onconnection,
      noop,
      noop,
      noop,
      noop,
      noop,
      this._onclose
    )

    if (this._state & constants.state.UNREFED) binding.unref(this._handle)

    try {
      binding.bind(this._handle, path, backlog)

      this._path = path

      this._state |= constants.state.BOUND
      this._state &= ~constants.state.BINDING

      if (onlistening) this.once('listening', onlistening)

      queueMicrotask(() => {
        if (this._state & constants.state.CLOSING) return

        this.emit('listening')
      })
    } catch (err) {
      this._error = err

      binding.close(this._handle)
    }

    return this
  }

  close(onclose) {
    if (this._state & constants.state.CLOSED) {
      if (onclose) queueMicrotask(onclose)

      return this
    }

    if (onclose) this.once('close', onclose)

    if (this._state & constants.state.CLOSING) return this
    this._state |= constants.state.CLOSING
    this._state &= ~(constants.state.BINDING | constants.state.BOUND)

    if (this._handle !== null) binding.close(this._handle)
    else this._closeMaybe()

    return this
  }

  ref() {
    this._state &= ~constants.state.UNREFED

    if (this._handle !== null) binding.ref(this._handle)

    return this
  }

  unref() {
    this._state |= constants.state.UNREFED

    if (this._handle !== null) binding.unref(this._handle)

    return this
  }

  _closeMaybe() {
    if ((this._state & constants.state.CLOSING) === 0) return
    if (this._state & constants.state.CLOSED) return
    if (this._handle !== null || this._connections.size > 0) return

    this._state |= constants.state.CLOSED
    this._state &= ~constants.state.CLOSING

    queueMicrotask(() => this.emit('close'))
  }

  _onconnection(err) {
    if (err) {
      this.emit('error', err)
      return
    }

    if (this._state & constants.state.CLOSING) return

    const pipe = new exports.Pipe({
      readBufferSize: this._readBufferSize,
      allowHalfOpen: this._allowHalfOpen,
      eagerOpen: !this._pauseOnConnect,
      ipc: this._ipc
    })

    try {
      binding.accept(this._handle, pipe._handle)

      pipe._path = this._path

      pipe._onaccept()

      this._connections.add(pipe)

      pipe.on('close', () => {
        this._connections.delete(pipe)
        this._closeMaybe()
      })
    } catch (err) {
      pipe.destroy()

      this.emit('error', err)
      return
    }

    this.emit('connection', pipe)
  }

  _onclose() {
    const err = this._error

    this._state &= ~(constants.state.BINDING | constants.state.BOUND)
    this._error = null
    this._handle = null
    this._path = null

    if (err) this.emit('error', err)

    this._closeMaybe()
  }
}

exports.constants = constants
exports.errors = errors

exports.createConnection = function createConnection(path, opts, onconnect) {
  if (typeof opts === 'function') {
    onconnect = opts
    opts = {}
  }

  if (typeof path === 'object' && path !== null) {
    opts = path
    path = opts.path
  }

  return new exports.Pipe(opts).connect(path, opts, onconnect)
}

exports.createServer = function createServer(opts, onconnection) {
  return new exports.Server(opts, onconnection)
}

exports.pipe = function pipe() {
  return binding.pipe()
}

function toIPCHandle(target) {
  const handle = target[ipcHandle]

  if (handle === undefined) {
    throw errors.INVALID_IPC_TARGET('Target does not implement the IPC handle protocol')
  }

  if (handle instanceof ArrayBuffer === false) {
    throw errors.INVALID_IPC_TARGET('Target does not provide a native IPC handle')
  }

  return handle
}

function validatePath(path) {
  if (typeof path !== 'string') {
    throw errors.INVALID_PATH(`Path must be a string, got ${typeof path}`)
  }

  validatePathLength(path)
}

function validatePathLength(path) {
  const length = Buffer.byteLength(path)

  if (length > constants.path.MAX_LENGTH) {
    throw errors.INVALID_PATH(
      `Path must be at most ${constants.path.MAX_LENGTH} bytes, got ${length}`
    )
  }
}

function validateFd(fd) {
  if (typeof fd !== 'number') {
    throw errors.INVALID_FD(`File descriptor must be a number, got ${typeof fd}`)
  }

  if (!Number.isInteger(fd) || fd < 0 || fd > 0x7fffffff) {
    throw errors.INVALID_FD(
      `File descriptor must be an integer between 0 and ${0x7fffffff}, got ${fd}`
    )
  }
}

function validateInteger(value, name, min, max) {
  if (typeof value !== 'number') {
    throw errors.INVALID_ARGUMENT(`${name} must be a number, got ${typeof value}`)
  }

  if (!Number.isInteger(value) || value < min || value > max) {
    throw errors.INVALID_ARGUMENT(
      `${name} must be an integer between ${min} and ${max}, got ${value}`
    )
  }
}

function coerceBatch(batch) {
  for (let i = 0; i < batch.length; i++) {
    const chunk = batch[i].chunk

    if (ArrayBuffer.isView(chunk) === false) {
      throw errors.INVALID_ARGUMENT(`Chunk must be a string or a view, got ${typeof chunk}`)
    }

    batch[i].chunk = Buffer.coerce(chunk)
  }
}

function defaultTo(value, fallback) {
  return value === undefined || value === null ? fallback : value
}

function noop() {}
