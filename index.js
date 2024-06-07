const DHT = require('hyperdht')
const Corestore = require('corestore')
const { Server: RelayServer } = require('blind-relay')

async function setupBlindRelay ({ storage, port }) {
  const store = new Corestore(storage)
  console.log('storage', storage, port)

  const dht = new DHT({ port })

  const relay = new RelayServer({
    createStream (opts) {
      return dht.createRawStream({ ...opts, framed: true })
    }
  })

  const server = dht.createServer((socket) => {
    socket.setKeepAlive(5000)

    socket
      .on('error', noop)

    const session = relay.accept(socket, { id: socket.remotePublicKey })
    session
      .on('error', noop)
  })

  await server.listen(await store.createKeyPair('blind-relay'))

  return { server, relay }
}

function noop () {}

module.exports = setupBlindRelay
