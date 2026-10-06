# Build context is the parent of the Acorn and Joined checkouts:
#   Acorn/acorn-backend
#   Joined/backend-core
# go.mod replaces backend-core with ../../Joined/backend-core from this module.
FROM golang:1.26.4-bookworm AS build

WORKDIR /src/Acorn/acorn-backend

COPY Acorn/acorn-backend/go.mod Acorn/acorn-backend/go.sum ./
COPY Joined/backend-core /src/Joined/backend-core

RUN go mod download

COPY Acorn/acorn-backend/ ./

RUN CGO_ENABLED=0 go build -o /out/acorn-api ./cmd/server

FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /out/acorn-api /usr/local/bin/acorn-api

USER nobody
EXPOSE 8083
ENTRYPOINT ["acorn-api"]
