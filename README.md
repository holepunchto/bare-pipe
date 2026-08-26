# bare-pipe

Native I/O pipes for JavaScript.

```
npm i bare-pipe
```

## Usage

```js
const Pipe = require('bare-pipe')

const [read, write] = Pipe.pipe()

const reader = new Pipe(read)
const writer = new Pipe(write)

reader.on('data', (data) => console.log(data.toString()))

writer.end('Hello world!\n')
```

## API

#### `const pipe = new Pipe([path][, options])`

Create a new pipe. `pipe` extends <https://github.com/holepunchto/bare-stream>. If `path` is a number, it is treated as a file descriptor to open. If it is a string, it is treated as a path to connect to.

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

#### `const pipe = Pipe.createConnection(path[, options][, onconnect])`

Create a new pipe and connect it to `path`. Shorthand for `new Pipe(options).connect(path, options, onconnect)`.

#### `pipe.connecting`

Whether the pipe is currently connecting.

#### `pipe.pending`

Whether the pipe has not yet connected.

#### `pipe.readyState`

The current state of the pipe, as in Node:

- `'opening'` if the pipe is connecting.
- `'open'` if both halves of the pipe are open.
- `'readOnly'` if the writable half has ended.
- `'writeOnly'` if the readable half has ended.
- `'closed'` otherwise, including before the pipe connects.

#### `pipe.connect(path[, options][, onconnect])`

Connect the pipe to `path`. `onconnect` is called when the connection is established.

A path may be at most `Pipe.constants.path.MAX_LENGTH` bytes long, or `INVALID_PATH` is thrown. That is only the upper bound this module imposes; the platform limit is much lower, around 104 bytes on macOS and 108 bytes on Linux for a Unix domain socket, so a shorter path may still be rejected by the operating system with `EINVAL` or `ENAMETOOLONG`.

A failed connect destroys the pipe, so the pipe cannot be reused. The pipe stays connecting until the failure settles, as in Node, so `pipe.connect()` throws `PIPE_ALREADY_CONNECTED` until then and `PIPE_IS_CLOSED` from then on. A failed `pipe.open()` takes effect right away, so both `pipe.connect()` and `pipe.open()` throw `PIPE_IS_CLOSED` immediately, even before the resulting `error` event has been emitted.

#### `pipe.open(fd[, options][, onconnect])`

Open the pipe on the given file descriptor, such as one obtained from `Pipe.pipe()` or received over IPC. `onconnect` is called when the pipe is ready.

A descriptor that is only readable or only writable, such as one half of a pair, leaves the corresponding half of the pipe ended right away.

The descriptor must be one the event loop can poll, so a regular file or a directory is rejected with `EINVAL`. Standard I/O is only adoptable when it is a pipe or a socket; when it has been redirected to a file, use `bare-fs`, and when it is a terminal, use `bare-tty`.

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

A handle the listener does not accept stays pending and is emitted again on the next read, so a listener that skips a handle will see it more than once.

#### `const server = new Pipe.Server([options][, onconnection])`

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

These options are applied to each incoming pipe. If `onconnection` is provided, it is added as a listener for the `connection` event.

#### `const server = Pipe.createServer([options][, onconnection])`

Convenience function equivalent to `new Pipe.Server(options, onconnection)`.

#### `server.listening`

Whether the server is listening.

#### `server.closing`

Whether the server is closing.

#### `server.address()`

Returns the bound path, or `null` if the server is not listening.

#### `server.listen(path[, backlog[, options]][, onlistening])`

Start listening for connections on `path`. `backlog` defaults to `511`.

#### `server.close([onclose])`

Close the server, releasing the path right away so that no new connections are accepted. Existing connections are left open and the server emits `close` after all of them have ended. `server.listening` is `false` and `server.address()` returns `null` as soon as `close()` is called.

Once the server has fully closed, `server.closing` returns to `false` and the server may `listen()` again, as in Node.

A connection accepted with `allowHalfOpen: true` stays open after the peer closes its end: the peer's `FIN` ends only the readable half, and the writable half remains open until the local side ends it. Such a connection has not "ended", so it keeps the server open and `close` will not fire until you end it (for example `pipe.on('end', () => pipe.end())`). This matches Node's `net`, which also waits for half-open connections to end.

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

#### `const [read, write] = Pipe.pipe()`

Create a pair of file descriptors connected to each other, the first readable and the second writable. Use `pipe.open(fd)` to adopt them. The pair is a unidirectional pipe, so it carries data but not handles.

A descriptor is closed along with the pipe that adopted it, so a descriptor that is never adopted has to be closed by hand, such as with `bare-fs`.

#### `Pipe.constants`

Object containing internal state constants and handle types, as well as `path.MAX_LENGTH`, the maximum length in bytes of a path accepted by `pipe.connect()` and `server.listen()`:

```js
Pipe.constants.path.MAX_LENGTH

Pipe.constants.handle.NAMED_PIPE
Pipe.constants.handle.TCP
Pipe.constants.handle.UDP
```

#### `Pipe.errors`

Class for pipe specific errors, with a static factory per error code.

## IPC handle passing

Pipes created with `ipc: true` can transfer libuv handles (named pipes, TCP sockets, UDP sockets) to a peer alongside the byte stream. The peer receives a `'handle'` event for each transferred handle, in arrival order, before the corresponding `'data'` event.

Handle passing needs a bidirectional socket on both ends, so the descriptors must come from a socket pair, such as `bare-tcp`'s `socketpair()`. The descriptors from `Pipe.pipe()` are a unidirectional pipe and cannot carry handles.

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

`Pipe`, `bare-tcp`'s `Socket`, `bare-dgram`'s `Socket`, and any compatible package implement this protocol natively, so a `bare-tcp` socket can be passed and received via `bare-pipe` IPC without any glue code.

TypeScript users can import the `IPCAcceptable` interface from `bare-pipe` to type the protocol.

## License

Apache-2.0
