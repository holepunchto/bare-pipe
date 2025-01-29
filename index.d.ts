import EventEmitter, { EventMap } from 'bare-events'
import { Duplex, DuplexEvents } from 'bare-stream'

interface PipeEvents extends DuplexEvents {
  connect: []
}

interface PipeOptions {
  readBufferSize?: number
  allowHalfOpen?: boolean
}

interface PipeConnectOptions {
  path?: string
}

interface Pipe<M extends PipeEvents = PipeEvents> extends Duplex<M> {
  readonly connecting: boolean
  readonly pending: boolean
  readonly readyState: 'open' | 'readOnly' | 'writeOnly'

  open(fd: number, opts?: { fd?: number }, onconnect?: () => void): this

  open(fd: number, onconnect: () => void): this

  open(opts: { fd: number }, onconnect?: () => void): this

  connect(path: string, opts?: PipeConnectOptions, onconnect?: () => void): this

  connect(path: string, onconnect: () => void): this

  connect(opts: PipeConnectOptions, onconnect?: () => void): this

  ref(): void

  unref(): void
}

declare class Pipe<M extends PipeEvents = PipeEvents> extends Duplex<M> {
  constructor(path: string | number, opts?: PipeOptions)

  constructor(opts?: PipeOptions)
}

interface PipeServerEvents extends EventMap {
  close: []
  connection: [pipe: Pipe]
  err: [err: Error]
  listening: []
}

interface PipeServerOptions {
  readBufferSize?: number
  allowHalfOpen?: boolean
}

interface PipeServerListenOptions {
  path?: string
  backlog?: number
}

interface PipeServer<M extends PipeServerEvents = PipeServerEvents>
  extends EventEmitter<M> {
  readonly listening: boolean

  address(): string | null

  listen(
    path: string,
    backlog?: number,
    opts?: PipeServerListenOptions,
    onlistening?: () => void
  ): this

  listen(path: string, backlog: number, onlistening: () => void): this

  listen(path: string, onlistening: () => void): this

  listen(opts: PipeServerListenOptions): this

  close(onclose?: () => void): void

  ref(): void

  unref(): void
}

declare class PipeServer<
  M extends PipeServerEvents = PipeServerEvents
> extends EventEmitter<M> {
  constructor(opts?: PipeServerOptions, onconnection?: () => void)

  constructor(onconnection: () => void)
}

interface CreateConnectionOptions extends PipeOptions, PipeConnectOptions {}

declare function createConnection(
  path: string,
  opts?: CreateConnectionOptions,
  onconnect?: () => void
): Pipe

declare function createConnection(path: string, onconnect: () => void): Pipe

declare function createConnection(
  opts: CreateConnectionOptions,
  onconnect?: () => void
): Pipe

declare function createServer(
  opts?: PipeServerOptions,
  onconnection?: () => void
): PipeServer

declare function pipe(): [read: number, write: number]

declare const constants: {
  CONNECTING: number
  CONNECTED: number
  BINDING: number
  BOUND: number
  READING: number
  CLOSING: number
  READABLE: number
  WRITABLE: number
}

declare class PipeError extends Error {
  static PIPE_ALREADY_CONNECTED(msg: string): PipeError
  static SERVER_ALREADY_LISTENING(msg: string): PipeError
  static SERVER_IS_CLOSED(msg: string): PipeError
}

declare namespace Pipe {
  export {
    Pipe,
    pipe,
    PipeServer as Server,
    constants,
    PipeError as errors,
    createConnection,
    createServer
  }

  export type {
    PipeEvents,
    PipeOptions,
    PipeConnectOptions,
    PipeServerEvents,
    PipeServerOptions,
    PipeServerListenOptions,
    PipeServer,
    CreateConnectionOptions
  }
}

export = Pipe
