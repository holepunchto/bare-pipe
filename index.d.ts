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

interface ServerEvents extends EventMap {
  close: []
  connection: [pipe: Pipe]
  err: [err: Error]
  listening: []
}

interface ServerOptions {
  readBufferSize?: number
  allowHalfOpen?: boolean
}

interface ServerListenOptions {
  path?: string
  backlog?: number
}

interface Server<M extends ServerEvents = ServerEvents>
  extends EventEmitter<M> {
  readonly listening: boolean

  address(): string | null

  listen(
    path: string,
    backlog?: number,
    opts?: ServerListenOptions,
    onlistening?: () => void
  ): this

  listen(path: string, backlog: number, onlistening: () => void): this

  listen(path: string, onlistening: () => void): this

  listen(opts: ServerListenOptions): this

  close(onclose?: () => void): void

  ref(): void

  unref(): void
}

declare class Server<
  M extends ServerEvents = ServerEvents
> extends EventEmitter<M> {
  constructor(opts?: ServerOptions, onconnection?: () => void)

  constructor(onconnection: () => void)
}

declare class PipeError extends Error {
  static PIPE_ALREADY_CONNECTED(msg: string): PipeError
  static SERVER_ALREADY_LISTENING(msg: string): PipeError
  static SERVER_IS_CLOSED(msg: string): PipeError
}

declare namespace Pipe {
  export interface CreateConnectionOptions
    extends PipeOptions,
      PipeConnectOptions {}

  export function createConnection(
    path: string,
    opts?: CreateConnectionOptions,
    onconnect?: () => void
  ): Pipe

  export function createConnection(path: string, onconnect: () => void): Pipe

  export function createConnection(
    opts: CreateConnectionOptions,
    onconnect?: () => void
  ): Pipe

  export function createServer(
    opts?: ServerOptions,
    onconnection?: () => void
  ): Server

  export function pipe(): [read: number, write: number]

  export const constants: {
    CONNECTING: number
    CONNECTED: number
    BINDING: number
    BOUND: number
    READING: number
    CLOSING: number
    READABLE: number
    WRITABLE: number
  }

  export {
    Pipe,
    PipeEvents,
    PipeOptions,
    PipeConnectOptions,
    PipeError as errors,
    ServerEvents,
    ServerOptions
  }
}

export = Pipe
