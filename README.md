# blind-relay-service

Run a blind relay as CLI or Docker

## Install

### CLI

```sh
npm i --omit=optional blind-relay-service
```

### Docker

No install needed

## Usage

### CLI

```sh
blind-relay [-s, --storage <path>] [-p, --port <num>]
```

### Docker

```
docker run --network host --mount type=volume,source=blind-relay-volume,destination=/home/relay/corestore/ ghcr.io/holepunchto/blind-relay-service
```

Note: using a volume is optional, but highly recommended (it ensures the relay uses the same key pair on restart)

Note: using `--network host` is optional, but recommended (it avoids some edge cases with DHT connections over LAN)

## License

Apache-2.0
