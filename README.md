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

See the [`bare-pipe` reference](https://docs.pears.com/reference/bare/modules/bare-pipe).

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
