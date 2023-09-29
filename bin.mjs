#!/usr/bin/env node

import { program, createOption } from 'commander'
import id from 'hypercore-id-encoding'
import DHT from 'hyperdht'
import Corestore from 'corestore'
import { Server as RelayServer } from 'blind-relay'

program
  .addOption(createOption('-s, --storage <path>').default('./corestore'))
  .addOption(createOption('-p, --port <num>').default(49737).argParser(Number))
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

  const server = dht.createServer(socket => relay.accept(socket))

  await server.listen(await store.createKeyPair('blind-relay'))

  console.log('Server listening on', id.encode(server.publicKey))
}
