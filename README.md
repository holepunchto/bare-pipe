# bare-pipe

Native I/O pipes for JavaScript.

```
npm i bare-pipe
```

## Usage

``` js
const Pipe = require('bare-pipe')

const stdout = new Pipe().open(1)

stdout.write('Hello world!\n')
```

## License

Apache-2.0
