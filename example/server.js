const path = require('bare-path')
const Pipe = require('..')

const server = Pipe.createServer()
server
  .on('connection', (pipe) => {
    pipe
      .on('data', (data) => console.log(data.toString()))
      .end()
  })
  .listen(path.resolve(__dirname, 'pipe.socket'))
