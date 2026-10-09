# MeshSync Native Engine (C++20)

The native engine is a small, self-contained C++20 worker binary
(`meshsync-native`) that the Go agent spawns as a long-lived child process.
Large-file hashing runs here instead of inside the agent so the indexing
path stays non-blocking and gets hand-tuned SHA-256 throughput.

No external dependencies: no OpenSSL, no JSON library — everything
(sha256, json, io) is implemented in this tree.

## Build

```sh
make            # → bin/meshsync-native
make test       # builds + runs the test suite (bin/test_meshsync)
make bench      # hashing throughput benchmark (stderr output)
make clean
```

Compiler: `g++ -std=c++20 -O2 -Wall -Wextra -pthread`.

## Protocol (JSON-lines over stdin/stdout)

One JSON request object per line, one JSON response object per line,
flushed after every response. All diagnostics go to stderr — stdout
carries **only** protocol responses.

Requests:

```json
{"op":"hash","path":"/abs/path/file.bin"}
{"op":"hash_range","path":"/abs/file.bin","offset":1048576,"length":4194304}
{"op":"quit"}
```

Responses:

```json
{"ok":true,"hash":"<lowercase hex sha256>","bytes":268435456,"ms":812}
{"ok":false,"error":"cannot open '/x': No such file or directory"}
```

* `hash` — streaming SHA-256 of the whole file (1 MiB read buffer; the
  file is never loaded into memory). `bytes` = file size, `ms` = duration.
* `hash_range` — SHA-256 of exactly `length` bytes starting at `offset`
  (chunk verification). A read that hits EOF early is an error
  (truncated file), never a bogus digest.
* `quit` — exit code 0, no response.

The Go side lives in `agent/internal/native/native.go`
(`Start`/`HashFile`/`Stop`); when the binary is missing or dies the agent
falls back to pure-Go hashing and records a `NATIVE_FALLBACK` event.

## Components

| Class              | File                        | Purpose |
|--------------------|-----------------------------|---------|
| `Sha256`           | `sha256.{hpp,cpp}`          | FIPS 180-4 streaming SHA-256 (own implementation) |
| `FileReader`       | `file_reader.{hpp,cpp}`     | RAII streaming reader with precise error reporting |
| `FileHasher`       | `file_hasher.{hpp,cpp}`     | whole-file + range hashing through a 1 MiB buffer |
| `Chunker`          | `chunker.{hpp,cpp}`         | deterministic chunk layout (default 1 MiB) |
| `ChunkHash`        | `chunk_hash.{hpp,cpp}`      | per-chunk SHA-256 |
| `IntegrityVerifier`| `integrity_verifier.{hpp,cpp}` | verify file / range against expected hex |
| `FileScanner`      | `file_scanner.{hpp,cpp}`    | recursive directory walk (path, size, mtime) |
| `json::Value`      | `json.{hpp,cpp}`            | minimal JSON parse/serialize with full string escapes |

Worker entry point: `src/main.cpp`.

## Tests

`make test` runs `tests/test_main.cpp` (plain asserts, no framework):

* SHA-256 known vectors: empty, "abc", fox sentence, 1,000,000 × 'a',
  streaming-consistency of 1 MiB pattern data across update splits
* large-file hashing: a 256 MiB file generated at runtime in /tmp
  (never committed), hashed with different buffer sizes — deterministic
  digest and correct byte count
* chunking correctness: coverage invariants for edge sizes
* chunk hash verification against in-memory range digests
* corrupted chunk detection: one flipped byte → mismatch, neighbors intact
* interrupted read: range beyond EOF / truncated file → error
* JSON round-trips: escapes, \uXXXX (incl. surrogate pairs), key order,
  invalid inputs rejected
* FileScanner: nested tree, sizes/mtimes, error paths
* protocol end-to-end: spawns the real worker over pipes and checks
  request/response pairs, error envelopes and the quit handshake

Benchmark mode:

```sh
./bin/meshsync-native --bench            # 256 MiB generated temp file
./bin/meshsync-native --bench /some/file # hash an existing file
```

Prints real measured throughput to stderr (`best of 2` passes).
