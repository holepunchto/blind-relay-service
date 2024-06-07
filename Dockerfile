FROM node:20-slim

RUN apt update && apt install curl -y

# Can be changed
ENV BLIND_RELAY_HTTP_PORT=18513

# Do not change (source of volume can be changed, but the target is always this)
ENV BLIND_RELAY_CORESTORE_LOC=/home/relay/corestore

RUN useradd --create-home relay

# Assumes optional deps are installed
# TODO: crash build if not
COPY node_modules /home/relay/node_modules

COPY package-lock.json /home/relay/
COPY lib /home/relay/lib
COPY package.json /home/relay/
COPY docker-entrypoint.js /home/relay/
COPY index.js /home/relay/
COPY LICENSE /home/relay/
COPY NOTICE /home/relay/

USER relay
RUN mkdir $BLIND_RELAY_CORESTORE_LOC # Ensures correct permissions if corestore mounted as volume

HEALTHCHECK --retries=1 --timeout=5s CMD curl --fail http://127.0.0.1:${BLIND_RELAY_HTTP_PORT}/health

ENTRYPOINT ["node", "/home/relay/docker-entrypoint.js"]
