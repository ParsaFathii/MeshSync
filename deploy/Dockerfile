# MeshSync agent — container image.
#
# Build (from the repository root):
#   docker build -f deploy/Dockerfile -t meshsync:local .
#
# The image contains ONLY the Go agent. The native C++20 hashing worker
# (native/cpp) is intentionally NOT bundled: the agent transparently falls
# back to pure-Go hashing when no worker is passed via --native-path, and
# emits a NATIVE_FALLBACK event (see docs/API.md). Bundling the worker would
# drag a full g++ toolchain or a cross-built binary into the image for a
# non-critical speedup — an honest trade-off, documented here.
# A future deploy/Dockerfile.native variant can add a g++ build stage
# (FROM gcc:... AS native + make -C native/cpp) and COPY the worker in.
#
# The agent is pure Go (modernc.org/sqlite, CGO_ENABLED=0) so this build
# cross-compiles cleanly for linux/amd64 and linux/arm64 via buildx.

# --- Stage 1: build the agent -------------------------------------------
FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS build
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src

# Module layer (cached unless go.mod/go.sum change).
COPY agent/go.mod agent/go.sum ./
RUN go mod download

# Source + build.
COPY agent/ ./
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w" -o /out/meshsync-agent ./cmd/meshsync-agent

# --- Stage 2: runtime ----------------------------------------------------
FROM alpine:3.22

# ca-certificates: outbound TLS to peers/registries when needed.
# tzdata: correct timestamps for scheduled scans / logs.
RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -g 10001 meshsync \
    && adduser -u 10001 -G meshsync -D -H meshsync \
    && mkdir -p /data \
    && chown -R meshsync:meshsync /data

COPY --from=build /out/meshsync-agent /usr/local/bin/meshsync-agent

# Never run as root.
USER meshsync:meshsync

# Agent state (SQLite database, identity keys, trash) — mount a volume here.
VOLUME ["/data"]

# 3040: local HTTP API + WebSocket events. 4040: peer sync (TLS).
EXPOSE 3040 4040

# The Docker healthcheck hits the real liveness endpoint (docs/API.md).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3040/api/v1/health || exit 1

# In a container the API must bind all interfaces of the container network
# namespace (the host decides what is exposed via port publishing). Publish
# as 127.0.0.1:3040:3040 to keep it loopback-only on the host, and configure
# --api-token before exposing the API beyond localhost.
ENTRYPOINT ["/usr/local/bin/meshsync-agent"]
CMD ["--data-dir", "/data", "--api-bind", "0.0.0.0", "--api-port", "3040", "--peer-port", "4040"]
