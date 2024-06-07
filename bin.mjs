#!/usr/bin/env node

import { program, createOption } from 'commander'
import id from 'hypercore-id-encoding'
import replSwarm from 'repl-swarm'
import setupBlindRelay from './index.js'

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
  const storage = opts.storage
  const port = opts.port
  const useRepl = opts.repl

  const { server, relay } = await setupBlindRelay({
    storage,
    port
  })

  if (useRepl) {
    replSwarm({ dht: server.dht, relay, server })
  }

  console.log('Server listening on', id.encode(server.publicKey))
}
