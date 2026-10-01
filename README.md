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

## Local access control

A server can restrict its pipe to the current user, and either end can ask the operating system who is on the other end.

```js
const server = Pipe.createServer((pipe) => {
  const credentials = pipe.remoteCredentials()

  if (/* not valid credentials */) return pipe.destroy()

  pipe.end('hello\n')
})

server.listen({ path, ownerOnly: true })
```

What counts as valid credentials is up to the application, such as a `uid` matching the current user on Unix or a `sid` matching it on Windows.

`ownerOnly` applies the restriction before the server listens, and disconnects some clients as soon as they are accepted, without a `connection` event.

On Unix the socket file is made `0600`, without following a symbolic link that replaced it, which on Linux requires Linux 6.6 or later or a mounted `/proc`. A client whose user is neither that of the server nor root is disconnected, which the mode alone admits when the client may bypass it, such as a process with `CAP_DAC_OVERRIDE` on Linux.

On Windows the pipe gets a protected DACL that allows only the current user and `SYSTEM`, any client that opened the pipe before the DACL was applied is disconnected, and so is:

- A remote client.
- A client whose process runs as a user other than that of the server or `SYSTEM`. The DACL alone admits these when they connect while impersonating the current user.
- A client running at a lower integrity level than the server, such as an unelevated process seen from an elevated server or a sandboxed low integrity process. The DACL alone admits these, as they run as the same user.
- A client whose process the server may not query, such as an elevated process or one running as `SYSTEM` seen from an unelevated server, or one that has exited.

Keep the socket in a directory only the current user can write to, so that its path cannot be replaced. An abstract socket has no file to restrict, so `ownerOnly` is rejected for one.

`pipe.remoteCredentials()` returns `{ pid, uid, gid, sid }`, with `null` for anything the platform cannot report. On Linux it reads `SO_PEERCRED`; on macOS and the BSDs `getpeereid()`, plus `LOCAL_PEERPID` on macOS. Read the credentials while the peer is connected: on macOS the process ID is no longer available once the peer has closed its end.

On Windows the process ID comes from the pipe. A remote peer reports no process ID or SID, since its process ID names a process on another machine.

On the server end, the SID is the user of the client process with that ID: the user the process runs as, not one it impersonated while connecting. It does not tell an elevated process from an unelevated one of the same user. The SID is `null`:

- For a client that has exited, once nothing holds its process open. Read the credentials while the client is alive.
- For a process created after the server accepted the connection, as it has reused the ID of a client that exited.
- For a client process the server may not query, such as an elevated process seen from an unelevated server.
- For a server end opened from a handle or received over IPC, as it may have connected at any time.

The check for a reused ID, which `ownerOnly` also relies on, has two gaps. A client that exits and has its ID reused while its connection waits to be accepted goes unnoticed, and so does a reuse after the system clock is set back, as process creation times are read from it.

On the client end, the process ID names the process that created the pipe, which may since have exited and had its ID reused. The SID is instead the owner of the pipe, which the kernel records when the server creates it, and which is the user of the server process, except for an elevated administrator, whose pipes are owned by the `Administrators` group (`S-1-5-32-544`). Only a process holding `SeRestorePrivilege`, such as an elevated administrator, can make another user the owner.

## License

Apache-2.0
