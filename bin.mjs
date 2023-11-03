#!/usr/bin/env node

import { program, createOption } from 'commander'
import id from 'hypercore-id-encoding'
import DHT from 'hyperdht'
import Corestore from 'corestore'
import { Server as RelayServer } from 'blind-relay'
import replSwarm from 'repl-swarm'

program
  .addOption(createOption('-s, --storage <path>').default('./corestore'))
  .addOption(createOption('-p, --port <num>').default(49737).argParser(Number))
  .addOption(createOption('-r, --repl').default(false))
  .action(action)
  .parseAsync()
  .catch(err => {
    console.error(`error: ${err.message}`)
    process.exitCode = 1
  })

async function action (opts) {
  const store = new Corestore(opts.storage)

  const dht = new DHT({ port: opts.port })

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

  if (opts.repl) {
    replSwarm({ dht, relay, server })
  }

  console.log('Server listening on', id.encode(server.publicKey))
}

function noop () {}
