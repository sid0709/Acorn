# Build context is the Acorn repo. backend-core sits next to acorn-agent,
# and go.mod replaces the module with ../backend-core. The agent has no
# database and no third-party modules, so there is no go.sum to copy.
FROM golang:1.26.4-bookworm AS build

WORKDIR /src/acorn-agent

COPY acorn-agent/go.mod ./
COPY backend-core /src/backend-core

COPY acorn-agent/ ./

RUN CGO_ENABLED=0 go build -o /out/acorn-agent ./cmd/agent

FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /out/acorn-agent /usr/local/bin/acorn-agent

# The agent keeps each run in memory and writes nothing: no data folder, no traces.
USER nobody
EXPOSE 8093
ENTRYPOINT ["acorn-agent"]
