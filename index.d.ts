import EventEmitter, { EventMap } from 'bare-events'
import Buffer, { BufferEncoding } from 'bare-buffer'
import { Duplex, DuplexEvents } from 'bare-stream'
import PipeError from './lib/errors'
import constants from './lib/constants'

declare const ipcHandle: unique symbol
declare const ipcAccept: unique symbol

interface IPCAcceptable {
  readonly [ipcHandle]: unknown
  [ipcAccept]?(): void
}

interface PipeEvents extends DuplexEvents {
  /** Emitted once the pipe has connected. */
  connect: []
  /** Emitted when an IPC handle is received, carrying the handle type. */
  handle: [type: number]
}

interface PipeOptions {
  allowHalfOpen?: boolean
  eagerOpen?: boolean
  ipc?: boolean
  readBufferSize?: number
}

interface PipeConnectOptions {
  path?: string
}

interface PipeOpenOptions {
  fd?: number
}

interface Pipe<M extends PipeEvents = PipeEvents> extends Duplex<M>, IPCAcceptable {
  /** Whether the pipe is currently connecting. */
  readonly connecting: boolean
  /** Whether the pipe has not yet connected. */
  readonly pending: boolean
  /**
   * The current state of the pipe. One of `'open'`, `'opening'`, `'readOnly'`, `'writeOnly'`, or
   * `'closed'`.
   */
  readonly readyState: 'open' | 'opening' | 'readOnly' | 'writeOnly' | 'closed'

  /**
   * Connect the pipe to `path`. `onconnect` is called when the connection is established.
   * @param path - The path to connect to.
   * @param opts - Options; `path` may be given here instead of as the first argument.
   * @param onconnect - Called when the connection is established.
   * @throws {PIPE_ALREADY_CONNECTED} the pipe is already connecting or connected.
   */
  connect(path: string, opts?: PipeConnectOptions, onconnect?: () => void): this
  connect(path: string, onconnect: () => void): this
  connect(opts: PipeConnectOptions, onconnect?: () => void): this

  /**
   * Open the pipe on the given file descriptor.
   * @param fd - The file descriptor to open the pipe on.
   * @param onconnect - Called once when the pipe emits `'connect'`.
   */
  open(fd: number, opts?: PipeOpenOptions, onconnect?: () => void): this
  open(fd: number, onconnect: () => void): this
  open(opts: PipeOpenOptions & { fd: number }, onconnect?: () => void): this

  /**
   * Write `chunk` to the pipe. If `handle` is given and the pipe was created with `ipc: true`, the
   * handle is transferred to the receiver alongside the chunk. `handle` must implement the
   * [`IPCAcceptable`](#ipcacceptable) protocol.
   * @param chunk - The data to write.
   * @param encoding - The encoding of `chunk` when it is a string.
   * @param handle - A handle to transfer to the receiver alongside the chunk; requires the pipe to
   * have been created with `ipc: true` and `handle` to implement the `IPCAcceptable` protocol.
   * @param cb - Called when the chunk has been processed.
   */
  write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    handle?: IPCAcceptable,
    cb?: (err: Error | null) => void
  ): boolean
  write(chunk: Buffer | string, encoding: BufferEncoding, cb?: (err: Error | null) => void): boolean
  write(chunk: Buffer | string, handle?: IPCAcceptable, cb?: (err: Error | null) => void): boolean
  write(chunk: Buffer | string, cb?: (err: Error | null) => void): boolean

  /**
   * Accept a pending handle into `target`. `target` must implement the
   * [`IPCAcceptable`](#ipcacceptable) protocol. Call this synchronously from the `'handle'` event
   * listener.
   * @param target - The object to accept the pending handle into; must implement the
   * `IPCAcceptable` protocol. Call synchronously from the `'handle'` event listener.
   * @returns `target`, for chaining the accepted handle into an expression.
   * @throws {INVALID_IPC_TARGET} `target` does not implement the IPC handle protocol.
   */
  accept<T extends IPCAcceptable>(target: T): T

  /** Ref the pipe, preventing the process from exiting. */
  ref(): this
  /** Unref the pipe, allowing the process to exit. */
  unref(): this
}

declare class Pipe<M extends PipeEvents = PipeEvents> extends Duplex<M> {
  /**
   * Create a new pipe. If `path` is a number, it is treated as a file descriptor to open. If it is
   * a string, it is treated as a path to connect to.
   * @param path - A file descriptor to open (number), or a path to connect to (string).
   * @param opts - Options; `readBufferSize` defaults to `65536`, `allowHalfOpen` and `eagerOpen` to
   * `true`, and `ipc` to `false` (set `ipc: true` to enable handle passing over the pipe).
   */
  constructor(path: string | number, opts?: PipeOptions)
  constructor(opts?: PipeOptions)
}

interface PipeServerEvents extends EventMap {
  /** Emitted once the server has closed and all existing connections have ended. */
  close: []
  /** Emitted with the accepted pipe each time a client connects. */
  connection: [pipe: Pipe]
  /** Emitted when the server fails to accept a connection or its handle closes with an error. */
  error: [err: Error]
  /** Emitted once the server has begun listening. */
  listening: []
}

interface PipeServerOptions {
  allowHalfOpen?: boolean
  ipc?: boolean
  pauseOnConnect?: boolean
  readBufferSize?: number
}

interface PipeServerListenOptions {
  backlog?: number
  path?: string
}

interface PipeServer<M extends PipeServerEvents = PipeServerEvents> extends EventEmitter<M> {
  /** Whether the server is listening. */
  readonly listening: boolean
  readonly closing: boolean

  /**
   * @returns The bound path, or `null` if the server is not listening.
   */
  address(): string | null

  /**
   * Start listening for connections on `path`. `backlog` defaults to `511`.
   * @param path - The path to listen on.
   * @param backlog - The maximum length of the queue of pending connections (default `511`).
   * @param opts - `path` and `backlog` may be given here instead of as positional arguments.
   * @param onlistening - Called once when the server emits `'listening'`.
   * @throws {SERVER_ALREADY_LISTENING} the server is already listening.
   * @throws {SERVER_IS_CLOSED} the server has been closed.
   */
  listen(
    path: string,
    backlog?: number,
    opts?: PipeServerListenOptions,
    onlistening?: () => void
  ): this
  listen(path: string, backlog: number, onlistening: () => void): this
  listen(path: string, onlistening: () => void): this
  listen(opts: PipeServerListenOptions, onlistening?: () => void): this

  /**
   * Close the server. No new connections will be accepted. The server emits `close` after all
   * existing connections have ended.
   * @param onclose - Called once when the server emits `'close'`, after all existing connections
   * have ended.
   */
  close(onclose?: () => void): this

  ref(): this
  unref(): this
}

declare class PipeServer<M extends PipeServerEvents = PipeServerEvents> extends EventEmitter<M> {
  /**
   * @param opts - Options applied to each incoming pipe; `readBufferSize` defaults to `65536`,
   * `allowHalfOpen` to `true`, `pauseOnConnect` to `false`, and `ipc` to `false`.
   * @param onconnection - Called on each `'connection'` event.
   */
  constructor(opts?: PipeServerOptions, onconnection?: (pipe: Pipe) => void)
  constructor(onconnection: (pipe: Pipe) => void)
}

declare namespace Pipe {
  export interface CreateConnectionOptions extends PipeOptions, PipeConnectOptions {}

  /**
   * Create a new pipe and connect it to `path`. Shorthand for `new Pipe(options).connect(path,
   * options, onconnect)`.
   * @param path - The path to connect to.
   * @param opts - Options passed to both the `Pipe` constructor and `connect()`.
   * @param onconnect - Called when the connection is established.
   */
  export function createConnection(
    path: string,
    opts?: CreateConnectionOptions,
    onconnect?: () => void
  ): Pipe

  export function createConnection(path: string, onconnect: () => void): Pipe

  export function createConnection(opts: CreateConnectionOptions, onconnect?: () => void): Pipe

  /**
   * Create a new pipe server. The server extends
   * [`EventEmitter`](https://github.com/holepunchto/bare-events).
   * @param opts - Options applied to each incoming pipe; `readBufferSize` defaults to `65536`,
   * `allowHalfOpen` to `true`, `pauseOnConnect` to `false`, and `ipc` to `false`.
   * @param onconnection - Called on each `'connection'` event.
   */
  export function createServer(
    opts?: PipeServerOptions,
    onconnection?: (pipe: Pipe) => void
  ): PipeServer

  export function createServer(onconnection: (pipe: Pipe) => void): PipeServer

  /**
   * @returns A `[read, write]` pair of file descriptors connected to each other.
   */
  export function pipe(): [read: number, write: number]

  export {
    Pipe,
    type PipeServer,
    PipeServer as Server,
    constants,
    type PipeError,
    PipeError as errors,
    type IPCAcceptable,
    type PipeConnectOptions,
    type PipeEvents,
    type PipeOpenOptions,
    type PipeOptions,
    type PipeServerEvents,
    type PipeServerListenOptions,
    type PipeServerOptions
  }
}

export = Pipe
