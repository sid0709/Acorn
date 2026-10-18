# Build context is the Acorn repo.
FROM golang:1.26.4-bookworm AS build

WORKDIR /src/acorn-backend

COPY acorn-backend/go.mod acorn-backend/go.sum ./
RUN go mod download

COPY acorn-backend/ ./

RUN CGO_ENABLED=0 go build -o /out/acorn-api ./cmd/server

FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /out/acorn-api /usr/local/bin/acorn-api

USER nobody
EXPOSE 8083
ENTRYPOINT ["acorn-api"]
