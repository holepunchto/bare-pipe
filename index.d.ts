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
  connect: []
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
  readonly connecting: boolean
  readonly pending: boolean
  readonly readyState: 'open' | 'readOnly' | 'writeOnly' | 'opening'

  connect(path: string, opts?: PipeConnectOptions, onconnect?: () => void): this
  connect(path: string, onconnect: () => void): this
  connect(opts: PipeConnectOptions, onconnect?: () => void): this

  open(fd: number, opts?: PipeOpenOptions, onconnect?: () => void): this
  open(fd: number, onconnect: () => void): this
  open(opts: PipeOpenOptions & { fd: number }, onconnect?: () => void): this

  write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    handle?: IPCAcceptable,
    cb?: (err: Error | null) => void
  ): boolean
  write(chunk: Buffer | string, encoding: BufferEncoding, cb?: (err: Error | null) => void): boolean
  write(chunk: Buffer | string, handle?: IPCAcceptable, cb?: (err: Error | null) => void): boolean
  write(chunk: Buffer | string, cb?: (err: Error | null) => void): boolean

  accept<T extends IPCAcceptable>(target: T): T

  ref(): this
  unref(): this
}

declare class Pipe<M extends PipeEvents = PipeEvents> extends Duplex<M> {
  constructor(path: string | number, opts?: PipeOptions)
  constructor(opts?: PipeOptions)
}

interface PipeServerEvents extends EventMap {
  close: []
  connection: [pipe: Pipe]
  error: [err: Error]
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
  readonly listening: boolean
  readonly closing: boolean

  address(): string | null

  listen(
    path: string,
    backlog?: number,
    opts?: PipeServerListenOptions,
    onlistening?: () => void
  ): this
  listen(path: string, backlog: number, onlistening: () => void): this
  listen(path: string, onlistening: () => void): this
  listen(opts: PipeServerListenOptions, onlistening?: () => void): this

  close(onclose?: () => void): this

  ref(): this
  unref(): this
}

declare class PipeServer<M extends PipeServerEvents = PipeServerEvents> extends EventEmitter<M> {
  constructor(opts?: PipeServerOptions, onconnection?: () => void)
  constructor(onconnection: () => void)
}

declare namespace Pipe {
  export interface CreateConnectionOptions extends PipeOptions, PipeConnectOptions {}

  export function createConnection(
    path: string,
    opts?: CreateConnectionOptions,
    onconnect?: () => void
  ): Pipe

  export function createConnection(path: string, onconnect: () => void): Pipe

  export function createConnection(opts: CreateConnectionOptions, onconnect?: () => void): Pipe

  export function createServer(opts?: PipeServerOptions, onconnection?: () => void): PipeServer

  export function createServer(onconnection: () => void): PipeServer

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
