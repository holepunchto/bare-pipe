# bare-pipe

Native I/O pipes for JavaScript.

```
npm i bare-pipe
```

## Usage

```js
const Pipe = require('bare-pipe')

const stdout = new Pipe(1)

stdout.write('Hello world!\n')
```

## API

#### `const pipe = new Pipe([path][, options])`

Create a new pipe. If `path` is a number, it is treated as a file descriptor to open. If it is a string, it is treated as a path to connect to.

Options include:

```js
options = {
  readBufferSize: 65536,
  allowHalfOpen: true,
  eagerOpen: true,
  ipc: false
}
```

Set `ipc: true` to enable handle passing over the pipe. See [IPC handle passing](#ipc-handle-passing).

#### `pipe.connecting`

Whether the pipe is currently connecting.

#### `pipe.pending`

Whether the pipe has not yet connected.

#### `pipe.readyState`

The current state of the pipe. One of `'open'`, `'readOnly'`, `'writeOnly'`, or `'opening'`.

#### `pipe.open(fd[, options][, onconnect])`

Open the pipe on the given file descriptor.

#### `pipe.connect(path[, options][, onconnect])`

Connect the pipe to `path`. `onconnect` is called when the connection is established.

#### `pipe.write(chunk[, encoding][, handle][, cb])`

Write `chunk` to the pipe. If `handle` is given and the pipe was created with `ipc: true`, the handle is transferred to the receiver alongside the chunk. `handle` must implement the [`IPCAcceptable`](#ipc-handle-passing) protocol.

#### `pipe.accept(target)`

Accept a pending handle into `target`. `target` must implement the [`IPCAcceptable`](#ipc-handle-passing) protocol. Call this synchronously from the `'handle'` event listener. Throws `INVALID_IPC_TARGET` if `target` does not implement the protocol.

#### `pipe.ref()`

Ref the pipe, preventing the process from exiting.

#### `pipe.unref()`

Unref the pipe, allowing the process to exit.

#### `event: 'connect'`

Emitted when the pipe connects.

#### `event: 'handle'`

Emitted on the receiving side for each pending handle when the pipe was created with `ipc: true`. The argument is the handle type, one of `Pipe.constants.handle.NAMED_PIPE`, `TCP`, or `UDP`. The listener must call `pipe.accept(target)` synchronously to claim the handle. Multiple handles arriving in a single read are emitted in arrival order before the corresponding `'data'` event.

#### `const server = Pipe.createServer([options][, onconnection])`

Create a new pipe server. `server` extends <https://github.com/holepunchto/bare-events>.

Options include:

```js
options = {
  readBufferSize: 65536,
  allowHalfOpen: true,
  pauseOnConnect: false,
  ipc: false
}
```

These options are applied to each incoming pipe.

#### `server.listening`

Whether the server is listening.

#### `server.address()`

Returns the bound path, or `null` if the server is not listening.

#### `server.listen(path[, backlog[, options]][, onlistening])`

Start listening for connections on `path`. `backlog` defaults to `511`.

#### `server.close([onclose])`

Close the server. No new connections will be accepted. The server emits `close` after all existing connections have ended.

#### `server.ref()`

Ref the server, preventing the process from exiting.

#### `server.unref()`

Unref the server, allowing the process to exit.

#### `event: 'listening'`

Emitted when the server starts listening.

#### `event: 'connection'`

Emitted when a new connection is received. The argument is a `Pipe`.

#### `event: 'close'`

Emitted when the server closes.

#### `event: 'error'`

Emitted when an error occurs.

#### `const pipe = Pipe.createConnection(path[, options][, onconnect])`

Create a new pipe and connect it to `path`. Shorthand for `new Pipe(options).connect(path, options, onconnect)`.

#### `Pipe.pipe()`

Returns `[read, write]`, a pair of file descriptors connected to each other.

#### `Pipe.constants`

Object containing internal state constants and handle type constants:

```js
Pipe.constants.handle.NAMED_PIPE
Pipe.constants.handle.TCP
Pipe.constants.handle.UDP
```

## IPC handle passing

Pipes created with `ipc: true` can transfer libuv handles (named pipes, TCP sockets, UDP sockets) to a peer alongside the byte stream. The peer receives a `'handle'` event for each transferred handle, in arrival order, before the corresponding `'data'` event.

Sender:

```js
const left = new Pipe(fd, { ipc: true })
const socket = tcp.createConnection(port)

socket.on('connect', () => {
  left.write(Buffer.from('here'), socket)
})
```

Receiver:

```js
const right = new Pipe(fd, { ipc: true })

right.on('handle', (type) => {
  if (type === Pipe.constants.handle.TCP) {
    const socket = new tcp.Socket()
    right.accept(socket)
    socket.on('data', console.log)
  }
})
```

### `IPCAcceptable` protocol

Any object passed to `pipe.accept(target)` or `pipe.write(chunk, handle, ...)` must implement two well-known symbols:

```js
const ipcHandle = Symbol.for('bare.ipc.handle')
const ipcAccept = Symbol.for('bare.ipc.accept')

class MyTarget {
  get [ipcHandle]() {
    return this._handle // An ArrayBuffer backing a libuv `uv_*_t` struct
  }

  [ipcAccept]() {
    // Optional: Called synchronously after the handle has been transferred
  }
}
```

- `Symbol.for('bare.ipc.handle')` (required): A getter returning the underlying libuv handle (typically an `ArrayBuffer` whose first bytes are a `uv_stream_t` / `uv_udp_t`).
- `Symbol.for('bare.ipc.accept')` (optional): A method invoked synchronously after the handle has been transferred. Use it to initialize per-handle state (e.g. address lookup).

`Pipe`, `bare-tcp`'s `Socket`, and any compatible package implement this protocol natively, so a `bare-tcp` socket can be passed and received via `bare-pipe` IPC without any glue code.

TypeScript users can import the `IPCAcceptable` interface from `bare-pipe` to type the protocol.

## License

Apache-2.0
