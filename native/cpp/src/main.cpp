// meshsync-native — the MeshSync C++20 hashing worker.
//
// The Go agent spawns this binary and speaks a JSON-lines protocol on
// stdin/stdout: exactly one JSON request object per line, exactly one JSON
// response object per line, flushed after every response.
//
//   request:  {"op":"hash","path":"..."}
//             {"op":"hash_range","path":"...","offset":N,"length":N}
//             {"op":"quit"}
//
//   response: {"ok":true,"hash":"<lowercase hex sha256>","bytes":N,"ms":N}
//             {"ok":false,"error":"..."}
//
// "quit" exits with status 0 without a response. Diagnostics are NEVER
// written to stdout — only to stderr.
//
//   --bench [file]   hash throughput benchmark (real measurements,
//                    printed to stderr; a 256 MiB temp file is generated
//                    when no path is given)
#include "meshsync/chunker.hpp"
#include "meshsync/file_hasher.hpp"
#include "meshsync/json.hpp"
#include "meshsync/sha256.hpp"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <iostream>
#include <string>
#include <unistd.h>
#include <vector>

namespace {

using meshsync::HashResult;
using meshsync::json::Value;

Value okResponse(const HashResult& r) {
    Value v = Value::makeObject();
    v.set("ok", Value::makeBool(true));
    v.set("hash", Value::makeString(r.hash));
    v.set("bytes", Value::makeInt(static_cast<std::int64_t>(r.bytes)));
    v.set("ms", Value::makeInt(r.ms));
    return v;
}

Value errResponse(const std::string& msg) {
    Value v = Value::makeObject();
    v.set("ok", Value::makeBool(false));
    v.set("error", Value::makeString(msg));
    return v;
}

Value handleRequest(const Value& req) {
    const Value* op = req.get("op");
    if (op == nullptr || op->type != Value::Type::String) {
        return errResponse("missing or invalid 'op'");
    }
    const std::string& opName = op->str;
    if (opName == "quit") {
        // handled by the caller
        return Value();
    }
    const Value* path = req.get("path");
    if (path == nullptr || path->type != Value::Type::String || path->str.empty()) {
        return errResponse("missing or invalid 'path'");
    }

    meshsync::FileHasher hasher;
    if (opName == "hash") {
        const HashResult r = hasher.hashFile(path->str);
        if (!r.ok) {
            return errResponse(r.error);
        }
        return okResponse(r);
    }
    if (opName == "hash_range") {
        const Value* offset = req.get("offset");
        const Value* length = req.get("length");
        if (offset == nullptr || length == nullptr) {
            return errResponse("hash_range requires 'offset' and 'length'");
        }
        if (offset->asInt(-1) < 0 || length->asInt(-1) < 0) {
            return errResponse("offset and length must be >= 0");
        }
        const HashResult r = hasher.hashRange(path->str, static_cast<std::uint64_t>(offset->asInt()),
                                               static_cast<std::uint64_t>(length->asInt()));
        if (!r.ok) {
            return errResponse(r.error);
        }
        return okResponse(r);
    }
    return errResponse("unknown op '" + opName + "'");
}

int runProtocol() {
    std::string line;
    while (std::getline(std::cin, line)) {
        // tolerate trailing \r (CRLF) and blank lines
        while (!line.empty() && (line.back() == '\r' || line.back() == '\n' || line.back() == ' ')) {
            line.pop_back();
        }
        if (line.empty()) {
            continue;
        }
        bool ok = false;
        Value req = meshsync::json::parse(line, &ok);
        if (!ok) {
            std::cout << meshsync::json::serialize(errResponse("invalid JSON request")) << '\n';
            std::cout.flush();
            continue;
        }
        const Value* op = req.get("op");
        if (op != nullptr && op->type == Value::Type::String && op->str == "quit") {
            return 0;
        }
        const Value resp = handleRequest(req);
        std::cout << meshsync::json::serialize(resp) << '\n';
        std::cout.flush(); // one response per line, always flushed
    }
    return 0; // stdin closed without quit
}

// ---- benchmark mode ----

std::string makeTempFile(std::uint64_t bytes) {
    namespace fs = std::filesystem;
    const std::string tmpl = (fs::temp_directory_path() / "meshsync-bench-XXXXXX").string();
    std::vector<char> name(tmpl.begin(), tmpl.end());
    name.push_back('\0');
    const int fd = mkstemp(name.data());
    if (fd < 0) {
        std::fprintf(stderr, "bench: mkstemp failed\n");
        std::exit(1);
    }
    std::FILE* f = fdopen(fd, "wb");
    if (f == nullptr) {
        close(fd);
        std::fprintf(stderr, "bench: fdopen failed\n");
        std::exit(1);
    }
    constexpr std::uint64_t kBlock = 1024 * 1024;
    std::vector<unsigned char> buf(kBlock);
    for (std::uint64_t i = 0; i < kBlock; ++i) {
        buf[i] = static_cast<unsigned char>((i * 131 + 7) & 0xff);
    }
    for (std::uint64_t written = 0; written < bytes;) {
        const std::uint64_t n = std::min(kBlock, bytes - written);
        if (std::fwrite(buf.data(), 1, n, f) != n) {
            std::fclose(f);
            std::fprintf(stderr, "bench: write failed\n");
            std::exit(1);
        }
        written += n;
    }
    std::fclose(f);
    return std::string(name.data());
}

int runBench(int argc, char** argv) {
    std::string path;
    bool tempFile = false;
    if (argc >= 3) {
        path = argv[2];
        if (!std::filesystem::exists(path)) {
            std::fprintf(stderr, "bench: file '%s' does not exist\n", path.c_str());
            return 1;
        }
    } else {
        path = makeTempFile(256ULL * 1024 * 1024);
        tempFile = true;
    }

    meshsync::FileHasher hasher;
    // warmup (page cache) then two measured passes
    (void)hasher.hashFile(path);
    double bestMiBps = 0.0;
    std::uint64_t totalBytes = 0;
    for (int pass = 0; pass < 2; ++pass) {
        const HashResult r = hasher.hashFile(path);
        if (!r.ok) {
            std::fprintf(stderr, "bench: hashing failed: %s\n", r.error.c_str());
            return 1;
        }
        totalBytes = r.bytes;
        const double ms = static_cast<double>(r.ms);
        const double mib = static_cast<double>(r.bytes) / (1024.0 * 1024.0);
        const double mibps = ms > 0.0 ? mib / (ms / 1000.0) : 0.0;
        if (mibps > bestMiBps) {
            bestMiBps = mibps;
        }
    }
    std::fprintf(stderr, "meshsync-native bench: %s | %llu bytes (%.1f MiB) | best of 2: %.1f MiB/s\n",
                 path.c_str(), static_cast<unsigned long long>(totalBytes),
                 static_cast<double>(totalBytes) / (1024.0 * 1024.0), bestMiBps);
    if (tempFile) {
        std::remove(path.c_str());
    }
    return 0;
}

} // namespace

int main(int argc, char** argv) {
    if (argc >= 2 && std::strcmp(argv[1], "--bench") == 0) {
        return runBench(argc, argv);
    }
    return runProtocol();
}
