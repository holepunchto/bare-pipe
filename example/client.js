const path = require('bare-path')
const Pipe = require('..')

const client = new Pipe(path.resolve(__dirname, 'pipe.socket'))
client.end('Hello world!')
