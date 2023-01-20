const { Readable, Writable } = require('streamx')
const binding = process.addon(__dirname)

// console.log(binding)

const handle = new Uint8Array(binding.sizeof_uv_tty_t)

binding.stdio_init(1, handle)

console.log(handle)

const buf = Buffer.from('hello world\n')

binding.stdio_write(handle, buf)

// class Stdout extends Readable {
//   constructor () {
//     super()


//   }
// }
