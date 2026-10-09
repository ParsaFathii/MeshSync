// meshsync-native — test suite.
//
// Unit tests link directly against the library sources; an integration test
// drives the real worker binary over its JSON-lines stdin/stdout protocol.
//
//   test_meshsync <path-to-meshsync-native>
//
// Exits 0 when every check passes, 1 otherwise. Each failure prints the
// file, line and observed values. Temp artifacts live in a mkdtemp
// directory removed on exit.
#include "meshsync/chunk_hash.hpp"
#include "meshsync/chunker.hpp"
#include "meshsync/file_hasher.hpp"
#include "meshsync/file_reader.hpp"
#include "meshsync/file_scanner.hpp"
#include "meshsync/integrity_verifier.hpp"
#include "meshsync/json.hpp"
#include "meshsync/sha256.hpp"

#include <fcntl.h>
#include <sys/select.h>
#include <sys/wait.h>
#include <unistd.h>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <string>
#include <vector>

namespace {

int g_failures = 0;
int g_checks = 0;

#define CHECK(cond)                                                              \
    do {                                                                         \
        ++g_checks;                                                              \
        if (!(cond)) {                                                           \
            ++g_failures;                                                        \
            std::fprintf(stderr, "FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond); \
        }                                                                        \
    } while (0)

#define CHECK_EQ_STR(actual, expected)                                            \
    do {                                                                          \
        ++g_checks;                                                               \
        const std::string a_ = (actual);                                          \
        const std::string e_ = (expected);                                        \
        if (a_ != e_) {                                                           \
            ++g_failures;                                                         \
            std::fprintf(stderr, "FAIL %s:%d  %s\n  actual:   \"%s\"\n  expected: \"%s\"\n", \
                         __FILE__, __LINE__, #actual, a_.c_str(), e_.c_str());    \
        }                                                                         \
    } while (0)

// ---------------------------------------------------------------- temp dir

class TempDir {
public:
    TempDir() {
        const std::string tmpl =
            (std::filesystem::temp_directory_path() / "meshsync-test-XXXXXX").string();
        std::vector<char> name(tmpl.begin(), tmpl.end());
        name.push_back('\0');
        if (mkdtemp(name.data()) == nullptr) {
            std::fprintf(stderr, "fatal: mkdtemp failed\n");
            std::exit(2);
        }
        path_ = std::string(name.data());
    }
    ~TempDir() {
        std::error_code ec;
        std::filesystem::remove_all(path_, ec);
    }
    TempDir(const TempDir&) = delete;
    TempDir& operator=(const TempDir&) = delete;

    const std::string& path() const { return path_; }
    std::string file(const std::string& name) const { return path_ + "/" + name; }

private:
    std::string path_;
};

void writeFile(const std::string& path, const std::string& content) {
    std::FILE* f = std::fopen(path.c_str(), "wb");
    if (f == nullptr) {
        std::fprintf(stderr, "fatal: cannot write %s\n", path.c_str());
        std::exit(2);
    }
    std::fwrite(content.data(), 1, content.size(), f);
    std::fclose(f);
}

// ---------------------------------------------------------------- sha256

void testSha256() {
    using meshsync::Sha256;
    std::fprintf(stderr, "  sha256\n");

    // NIST FIPS 180-4 vectors
    CHECK_EQ_STR(Sha256::hex(nullptr, 0),
                 "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    CHECK_EQ_STR(Sha256::hex(reinterpret_cast<const uint8_t*>("abc"), 3),
                 "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const char* v3 = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
    CHECK_EQ_STR(Sha256::hex(reinterpret_cast<const uint8_t*>(v3), std::strlen(v3)),
                 "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");

    // one million 'a' — exercises the multi-block path
    const std::string big(1000000, 'a');
    CHECK_EQ_STR(Sha256::hex(reinterpret_cast<const uint8_t*>(big.data()), big.size()),
                 "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");

    // streaming in odd-sized pieces must equal the one-shot digest
    const std::string mixed = "MeshSync native engine streaming update test 1234567890";
    const std::string oneShot =
        Sha256::hex(reinterpret_cast<const uint8_t*>(mixed.data()), mixed.size());
    {
        Sha256 s;
        s.update(reinterpret_cast<const uint8_t*>(mixed.data()), 7);
        s.update(reinterpret_cast<const uint8_t*>(mixed.data() + 7), 1);
        s.update(mixed.substr(8, 20));
        s.update(reinterpret_cast<const uint8_t*>(mixed.data() + 28), mixed.size() - 28);
        CHECK_EQ_STR(s.finalHex(), oneShot);
        // object is reusable after final()
        s.update(mixed);
        CHECK_EQ_STR(s.finalHex(), oneShot);
    }
    // update(const std::string&) overload
    {
        Sha256 s;
        s.update(mixed);
        CHECK_EQ_STR(s.finalHex(), oneShot);
    }
}

// ---------------------------------------------------------------- json

void testJson() {
    using meshsync::json::Value;
    std::fprintf(stderr, "  json\n");

    bool ok = false;

    // scalars
    Value v = meshsync::json::parse("true", &ok);
    CHECK(ok && v.type == Value::Type::Bool && v.boolean);
    v = meshsync::json::parse("false", &ok);
    CHECK(ok && v.type == Value::Type::Bool && !v.boolean);
    v = meshsync::json::parse("null", &ok);
    CHECK(ok && v.isNull());
    v = meshsync::json::parse("42", &ok);
    CHECK(ok && v.type == Value::Type::Int && v.integer == 42);
    v = meshsync::json::parse("9223372036854775807", &ok);
    CHECK(ok && v.type == Value::Type::Int && v.integer == 9223372036854775807LL);
    v = meshsync::json::parse("-1", &ok);
    CHECK(ok && v.type == Value::Type::Int && v.integer == -1);
    v = meshsync::json::parse("3.5", &ok);
    CHECK(ok && v.type == Value::Type::Double && v.number > 3.4 && v.number < 3.6);

    // strings with escapes, incl. \uXXXX
    v = meshsync::json::parse("\"line\\nnext\\t\\\"quoted\\\"\\\\slash\"", &ok);
    CHECK(ok && v.type == Value::Type::String);
    CHECK_EQ_STR(v.str, "line\nnext\t\"quoted\"\\slash");
    v = meshsync::json::parse("\"caf\\u00e9\"", &ok);
    CHECK(ok);
    CHECK_EQ_STR(v.str, "caf\xc3\xa9");

    // nested containers; member order preserved on round-trip
    const std::string doc =
        "{\"op\":\"hash\",\"path\":\"/tmp/a b.json\",\"meta\":{\"n\":7,\"arr\":[1,2,\"x\"]}}";
    v = meshsync::json::parse(doc, &ok);
    CHECK(ok && v.type == Value::Type::Object);
    CHECK_EQ_STR(v.get("op")->asString(), "hash");
    CHECK_EQ_STR(v.get("path")->asString(), "/tmp/a b.json");
    CHECK_EQ_STR(meshsync::json::serialize(v),
                 "{\"op\":\"hash\",\"path\":\"/tmp/a b.json\",\"meta\":{\"n\":7,\"arr\":[1,2,\"x\"]}}");

    // helpers
    CHECK_EQ_STR(v.get("op")->asString("def"), "hash");
    CHECK(v.get("nope") == nullptr);
    CHECK(v.get("meta")->get("n")->asInt() == 7);
    CHECK(v.get("meta")->get("arr")->array.size() == 3);
    CHECK_EQ_STR(v.get("meta")->get("arr")->array[2].asString(), "x");

    // make* builders and set() overwrite
    Value o = Value::makeObject();
    o.set("k", Value::makeInt(5));
    o.set("k", Value::makeString("replaced"));
    CHECK_EQ_STR(o.get("k")->asString(), "replaced");

    // rejections
    Value bad = meshsync::json::parse("{\"a\":1} trailing", &ok);
    CHECK(!ok && bad.isNull());
    bad = meshsync::json::parse("{\"a\":", &ok);
    CHECK(!ok);
    bad = meshsync::json::parse("\"unterminated", &ok);
    CHECK(!ok);
    bad = meshsync::json::parse("tru", &ok);
    CHECK(!ok);
    bad = meshsync::json::parse("", &ok);
    CHECK(!ok);
    // trailing whitespace is fine
    v = meshsync::json::parse(" 12 \n", &ok);
    CHECK(ok && v.integer == 12);

    // control characters are escaped on serialize (split literal so the
    // hex escape cannot swallow the following 'b')
    Value ctl = Value::makeString("a\x01" "b");
    CHECK(meshsync::json::serialize(ctl).find("\\u0001") != std::string::npos);
}

// ---------------------------------------------------------------- chunker

void testChunker() {
    using meshsync::Chunker;
    std::fprintf(stderr, "  chunker\n");

    const Chunker c1m;
    CHECK(c1m.chunkSize() == 1024 * 1024);

    // empty file: one zero-length chunk (every file is addressable)
    CHECK(c1m.chunkCount(0) == 1);
    CHECK(c1m.chunksFor(0).size() == 1);
    CHECK(c1m.chunksFor(0)[0].length == 0);

    // exact single chunk / one byte over / several
    CHECK(c1m.chunkCount(1024 * 1024) == 1);
    CHECK(c1m.chunkCount(1024 * 1024 + 1) == 2);
    CHECK(c1m.chunkCount(3 * 1024 * 1024 + 17) == 4);

    // layout covers the file exactly, offsets contiguous, index in order
    const std::uint64_t size = 1024 * 1024 * 2 + 12345;
    const auto chunks = c1m.chunksFor(size);
    std::uint64_t covered = 0;
    for (std::size_t i = 0; i < chunks.size(); ++i) {
        CHECK(chunks[i].index == i);
        CHECK(chunks[i].offset == covered);
        covered += chunks[i].length;
    }
    CHECK(covered == size);
    CHECK(chunks.back().length == 12345);

    // chunkAt agrees with chunksFor
    const auto c0 = c1m.chunkAt(size, 0);
    CHECK(c0.offset == 0 && c0.length == 1024 * 1024);
    const auto c2 = c1m.chunkAt(size, 2);
    CHECK(c2.offset == 2ULL * 1024 * 1024 && c2.length == 12345);

    // custom chunk size
    const Chunker c64(64);
    CHECK(c64.chunkCount(200) == 4);
    CHECK(c64.chunksFor(200)[3].length == 8);
    CHECK(c64.chunksFor(63)[0].length == 63);
}

// ---------------------------------------------------------------- file reader

void testFileReader(const TempDir& tmp) {
    using meshsync::FileReader;
    std::fprintf(stderr, "  file_reader\n");

    const std::string content = "0123456789ABCDEFGHIJ"; // 20 bytes
    const std::string path = tmp.file("reader.bin");
    writeFile(path, content);

    // missing file reports an error, ops are no-ops
    {
        FileReader r(tmp.file("nope.bin"));
        CHECK(!r.ok());
        CHECK(!r.error().empty());
        unsigned char buf[4];
        CHECK(!r.readExact(buf, 4));
    }
    {
        FileReader r(path);
        CHECK(r.ok());
        CHECK(r.size() == content.size());

        unsigned char buf[32] = {0};
        CHECK(r.readExact(buf, 20)); // consume the whole file
        CHECK(std::memcmp(buf, content.data(), 20) == 0);
        // exact EOF boundary: readSome returns 0 without error
        CHECK(r.readSome(buf, sizeof(buf)) == 0);
        // readExact past EOF is an error, never silently accepted
        CHECK(!r.readExact(buf, 1));

        // seek back and read a tail slice (bytes 14..19 = "EFGHIJ")
        CHECK(r.seekTo(14));
        CHECK(r.readExact(buf, 6));
        CHECK(std::memcmp(buf, "EFGHIJ", 6) == 0);
    }
    // move semantics keep the handle usable
    {
        FileReader a(path);
        FileReader b(std::move(a));
        CHECK(b.ok());
        unsigned char buf[4];
        CHECK(b.readExact(buf, 4));
        CHECK(std::memcmp(buf, "0123", 4) == 0);
    }
}

// ---------------------------------------------------------------- hasher

void testFileHasher(const TempDir& tmp) {
    using meshsync::FileHasher;
    using meshsync::Sha256;
    std::fprintf(stderr, "  file_hasher\n");

    const std::string content = "MeshSync hashing check \xE2\x9C\x93"; // UTF-8 tick
    const std::string path = tmp.file("hashme.bin");
    writeFile(path, content);
    const std::string want =
        Sha256::hex(reinterpret_cast<const uint8_t*>(content.data()), content.size());

    FileHasher h(16 * 1024); // small buffer forces multiple streaming passes
    CHECK(h.bufferSize() == 16 * 1024);

    // whole file
    const auto whole = h.hashFile(path);
    CHECK(whole.ok);
    CHECK_EQ_STR(whole.hash, want);
    CHECK(whole.bytes == content.size());
    CHECK(whole.error.empty());

    // a file spanning several 4 KiB-clamped buffer refills
    FileHasher tiny(4096); // 4 KiB is the clamp floor
    const std::string big(300 * 1024, 'x');
    const std::string bigPath = tmp.file("big.bin");
    writeFile(bigPath, big);
    const auto bigRes = tiny.hashFile(bigPath);
    CHECK(bigRes.ok);
    CHECK_EQ_STR(bigRes.hash,
                 Sha256::hex(reinterpret_cast<const uint8_t*>(big.data()), big.size()));

    // range hash equals the digest of the slice
    const auto range = h.hashRange(path, 9, 8);
    const std::string slice = content.substr(9, 8);
    CHECK(range.ok);
    CHECK_EQ_STR(range.hash,
                 Sha256::hex(reinterpret_cast<const uint8_t*>(slice.data()), slice.size()));
    CHECK(range.bytes == 8);

    // range over EOF is an error, not a silent short read
    const auto over = h.hashRange(path, 15, 100);
    CHECK(!over.ok);
    CHECK(!over.error.empty());

    // zero-length range at EOF is legal (empty digest)
    const auto empty = h.hashRange(path, content.size(), 0);
    CHECK(empty.ok);
    CHECK_EQ_STR(empty.hash, Sha256::hex(nullptr, 0));

    // missing file
    const auto missing = h.hashFile(tmp.file("gone.bin"));
    CHECK(!missing.ok);
    CHECK(!missing.error.empty());
}

// ---------------------------------------------------------------- chunk hash

void testChunkHash(const TempDir& tmp) {
    using meshsync::ChunkHash;
    using meshsync::Chunker;
    using meshsync::Sha256;
    std::fprintf(stderr, "  chunk_hash\n");

    // 2.5 chunks with the default 1 MiB chunker
    const std::size_t half = 1024 * 1024 / 2;
    const std::string data(2 * 1024 * 1024 + half, 0xAB);
    const std::string path = tmp.file("chunked.bin");
    writeFile(path, data);

    const Chunker chunker;
    ChunkHash ch;
    const auto results = ch.hashAllChunks(path, chunker, data.size());
    CHECK(results.size() == chunker.chunkCount(data.size()));
    CHECK(results.size() == 3);

    // every chunk digest equals the digest of the exact slice
    for (std::size_t i = 0; i < results.size(); ++i) {
        CHECK(results[i].ok);
        const std::size_t off = static_cast<std::size_t>(i * chunker.chunkSize());
        const std::size_t len = static_cast<std::size_t>(chunker.chunkAt(data.size(), i).length);
        const std::string slice = data.substr(off, len);
        CHECK_EQ_STR(results[i].hash,
                     Sha256::hex(reinterpret_cast<const uint8_t*>(slice.data()), slice.size()));
        CHECK(static_cast<std::uint64_t>(results[i].bytes) == len);
    }
    CHECK(results[0].bytes == 1024 * 1024);
    CHECK(results[2].bytes == half);

    // explicit range agrees with hashAllChunks for chunk 1
    const auto r1 = ch.hashRange(path, 1024 * 1024, 1024 * 1024);
    CHECK_EQ_STR(r1.hash, results[1].hash);
}

// ---------------------------------------------------------------- integrity

void testIntegrity(const TempDir& tmp) {
    using meshsync::IntegrityVerifier;
    using meshsync::Sha256;
    std::fprintf(stderr, "  integrity_verifier\n");

    const std::string content = "integrity payload 2026";
    const std::string path = tmp.file("verify.bin");
    writeFile(path, content);
    const std::string good =
        Sha256::hex(reinterpret_cast<const uint8_t*>(content.data()), content.size());

    IntegrityVerifier iv;

    // correct whole-file hash
    auto rep = iv.verifyFile(path, good);
    CHECK(rep.ok && rep.exists);
    CHECK_EQ_STR(rep.actualHash, good);
    CHECK(rep.bytes == content.size());

    // uppercase expected hash still matches (case-insensitive compare)
    std::string upper = good;
    for (auto& ch : upper) {
        ch = static_cast<char>(ch >= 'a' && ch <= 'f' ? ch - 32 : ch);
    }
    rep = iv.verifyFile(path, upper);
    CHECK(rep.ok);

    // one flipped byte changes the digest → mismatch detected with the
    // actual hash reported
    {
        std::string corrupt = content;
        corrupt[3] = static_cast<char>(corrupt[3] == 'X' ? 'Y' : 'X');
        const std::string cpath = tmp.file("corrupt.bin");
        writeFile(cpath, corrupt);
        const std::string wrongHash =
            Sha256::hex(reinterpret_cast<const uint8_t*>(corrupt.data()), corrupt.size());
        rep = iv.verifyFile(cpath, good);
        CHECK(rep.exists && !rep.ok);
        CHECK_EQ_STR(rep.actualHash, wrongHash);
    }

    // empty expected hash always fails
    rep = iv.verifyFile(path, "");
    CHECK(!rep.ok);

    // missing file
    rep = iv.verifyFile(tmp.file("absent.bin"), good);
    CHECK(!rep.exists && !rep.ok);
    CHECK(!rep.error.empty());

    // range verification
    const std::string slice = content.substr(4, 7);
    const std::string sliceHash =
        Sha256::hex(reinterpret_cast<const uint8_t*>(slice.data()), slice.size());
    rep = iv.verifyRange(path, 4, 7, sliceHash);
    CHECK(rep.ok && rep.exists && rep.bytes == 7);
    rep = iv.verifyRange(path, 4, 7, good);
    CHECK(rep.exists && !rep.ok);

    // shape-strict hex compare (pure comparator: same length, case-insensitive)
    CHECK(IntegrityVerifier::hashesEqual(good, upper));
    CHECK(IntegrityVerifier::hashesEqual("", ""));
    CHECK(!IntegrityVerifier::hashesEqual(good, good.substr(0, 63)));
    CHECK(!IntegrityVerifier::hashesEqual(good, "zz" + good.substr(2)));
    CHECK(!IntegrityVerifier::hashesEqual(good, good.substr(0, 63) + "0"));
}

// ---------------------------------------------------------------- scanner

void testFileScanner(const TempDir& tmp) {
    using meshsync::FileScanner;
    using meshsync::ScanEntry;
    std::fprintf(stderr, "  file_scanner\n");

    // a dedicated, clean root so other suites' temp files don't pollute it
    const std::string root = tmp.file("scanroot");
    std::filesystem::create_directories(root + "/sub/deep");
    writeFile(root + "/root.txt", "root");
    writeFile(root + "/sub/a.bin", std::string(10, 'a'));
    writeFile(root + "/sub/deep/b.txt", "b-in-deep");

    FileScanner scanner;
    std::vector<ScanEntry> entries;
    std::string error;
    CHECK(scanner.scan(root, entries, error));
    CHECK(error.empty());

    // 2 dirs + 3 files, sorted by relative path
    CHECK(entries.size() == 5);
    bool sawRoot = false, sawSub = false, sawDeep = false, sawA = false, sawB = false;
    std::string prev;
    for (const auto& e : entries) {
        CHECK(e.relPath > prev); // strictly sorted, no duplicates
        prev = e.relPath;
        if (e.relPath == "root.txt") {
            sawRoot = true;
            CHECK(!e.isDir && e.size == 4 && e.mtimeMs > 0);
        } else if (e.relPath == "sub") {
            sawSub = true;
            CHECK(e.isDir);
        } else if (e.relPath == "sub/a.bin") {
            sawA = true;
            CHECK(e.size == 10);
        } else if (e.relPath == "sub/deep") {
            sawDeep = true;
            CHECK(e.isDir);
        } else if (e.relPath == "sub/deep/b.txt") {
            sawB = true;
            CHECK(e.size == 9); // "b-in-deep"
        }
    }
    CHECK(sawRoot && sawSub && sawDeep && sawA && sawB);

    // symlink is never followed and never reported
    const std::string target = root + "/root.txt";
    if (::symlink(target.c_str(), (root + "/link.txt").c_str()) == 0) {
        std::vector<ScanEntry> withLink;
        CHECK(scanner.scan(root, withLink, error));
        bool found = false;
        for (const auto& e : withLink) {
            if (e.relPath == "link.txt") {
                found = true;
            }
        }
        CHECK(!found);
    }

    // nonexistent root fails with an error
    std::vector<ScanEntry> none;
    CHECK(!scanner.scan(tmp.file("does-not-exist"), none, error));
    CHECK(!error.empty());
}

// ------------------------------------------------------- worker integration

// One worker session: spawns the binary with pipes, feeds request lines,
// reads one response line per request.
class WorkerSession {
public:
    explicit WorkerSession(const std::string& bin) { spawned_ = spawn(bin); }
    ~WorkerSession() {
        if (running()) {
            sendLine("{\"op\":\"quit\"}");
            waitExit();
        }
    }
    WorkerSession(const WorkerSession&) = delete;
    WorkerSession& operator=(const WorkerSession&) = delete;

    bool running() const { return pid_ > 0; }

    bool sendLine(const std::string& line) {
        if (!running()) return false;
        const std::string withNl = line + "\n";
        return std::fwrite(withNl.data(), 1, withNl.size(), stdin_) == withNl.size() &&
               std::fflush(stdin_) == 0;
    }

    // Reads one response line with a 2s cap so a hung worker cannot wedge
    // the suite. Returns "" on EOF/timeout.
    std::string readLine() {
        if (!running()) return "";
        std::string out;
        char c = 0;
        while (true) {
            const int r = waitReadable(2);
            if (r <= 0) break;
            const ssize_t n = ::read(fdOut_, &c, 1);
            if (n <= 0) break;
            if (c == '\n') break;
            out.push_back(c);
            if (out.size() > (1U << 20)) break;
        }
        return out;
    }

    int waitExit() {
        if (pid_ <= 0) return status_;
        int st = 0;
        if (::waitpid(pid_, &st, 0) == pid_) {
            if (WIFEXITED(st)) status_ = WEXITSTATUS(st);
        }
        closeFds();
        return status_;
    }

private:
    bool spawn(const std::string& bin) {
        if (::pipe(pipeIn_) != 0) return false;   // parent -> child (stdin)
        if (::pipe(pipeOut_) != 0) return false;  // child -> parent (stdout)
        pid_ = ::fork();
        if (pid_ < 0) return false;
        if (pid_ == 0) {
            // child: stdin <- pipeIn_, stdout -> pipeOut_, stderr -> /dev/null
            ::dup2(pipeIn_[0], 0);
            ::dup2(pipeOut_[1], 1);
            const int devnull = ::open("/dev/null", O_WRONLY);
            if (devnull >= 0) {
                ::dup2(devnull, 2);
            }
            ::close(pipeIn_[0]);
            ::close(pipeIn_[1]);
            ::close(pipeOut_[0]);
            ::close(pipeOut_[1]);
            ::execl(bin.c_str(), bin.c_str(), static_cast<char*>(nullptr));
            ::_exit(127);
        }
        // parent keeps the write end of pipeIn_ and the read end of pipeOut_
        ::close(pipeIn_[0]);
        ::close(pipeOut_[1]);
        fdOut_ = pipeOut_[0];
        stdin_ = ::fdopen(pipeIn_[1], "w");
        return stdin_ != nullptr;
    }

    int waitReadable(int seconds) {
        fd_set set;
        FD_ZERO(&set);
        FD_SET(fdOut_, &set);
        timeval tv{};
        tv.tv_sec = seconds;
        return ::select(fdOut_ + 1, &set, nullptr, nullptr, &tv);
    }

    void closeFds() {
        if (stdin_ != nullptr) {
            std::fclose(stdin_);
            stdin_ = nullptr;
        }
        if (fdOut_ >= 0) {
            ::close(fdOut_);
            fdOut_ = -1;
        }
        pid_ = -1;
    }

    std::FILE* stdin_ = nullptr;
    pid_t pid_ = -1;
    int status_ = 0;
    int pipeIn_[2] = {-1, -1};
    int pipeOut_[2] = {-1, -1};
    int fdOut_ = -1;
    bool spawned_ = false;
};

void testWorkerProtocol(const TempDir& tmp, const std::string& bin) {
    using meshsync::Sha256;
    using meshsync::json::Value;
    std::fprintf(stderr, "  worker protocol (integration)\n");

    if (bin.empty() || !std::filesystem::exists(bin)) {
        std::fprintf(stderr, "    worker binary not provided — skipping\n");
        return;
    }

    const std::string content = "integration payload for the worker protocol";
    const std::string path = tmp.file("worker.bin");
    writeFile(path, content);
    const std::string want =
        Sha256::hex(reinterpret_cast<const uint8_t*>(content.data()), content.size());

    WorkerSession w(bin);
    CHECK(w.running());

    // happy path: whole-file hash
    CHECK(w.sendLine("{\"op\":\"hash\",\"path\":\"" + path + "\"}"));
    bool ok = false;
    Value resp = meshsync::json::parse(w.readLine(), &ok);
    CHECK(ok);
    CHECK(resp.get("ok") != nullptr && resp.get("ok")->asBool());
    CHECK_EQ_STR(resp.get("hash")->asString(), want);
    CHECK(resp.get("bytes")->asInt() == static_cast<std::int64_t>(content.size()));
    CHECK(resp.get("ms") != nullptr);

    // range hash
    const std::string slice = content.substr(12, 7);
    const std::string sliceHash =
        Sha256::hex(reinterpret_cast<const uint8_t*>(slice.data()), slice.size());
    CHECK(w.sendLine("{\"op\":\"hash_range\",\"path\":\"" + path + "\",\"offset\":12,\"length\":7}"));
    resp = meshsync::json::parse(w.readLine(), &ok);
    CHECK(ok && resp.get("ok")->asBool());
    CHECK_EQ_STR(resp.get("hash")->asString(), sliceHash);
    CHECK(resp.get("bytes")->asInt() == 7);

    // several sequential requests on the same session (statelessness)
    for (int i = 0; i < 3; ++i) {
        CHECK(w.sendLine("{\"op\":\"hash\",\"path\":\"" + path + "\"}"));
        resp = meshsync::json::parse(w.readLine(), &ok);
        CHECK(ok && resp.get("ok")->asBool());
        CHECK_EQ_STR(resp.get("hash")->asString(), want);
    }

    // missing file → typed error, protocol stays alive
    CHECK(w.sendLine("{\"op\":\"hash\",\"path\":\"" + tmp.file("missing.bin") + "\"}"));
    resp = meshsync::json::parse(w.readLine(), &ok);
    CHECK(ok && !resp.get("ok")->asBool());
    CHECK(!resp.get("error")->asString().empty());

    // invalid JSON line → error reply, not a crash
    CHECK(w.sendLine("this is not json"));
    resp = meshsync::json::parse(w.readLine(), &ok);
    CHECK(ok && !resp.get("ok")->asBool());

    // unknown op
    CHECK(w.sendLine("{\"op\":\"frobnicate\",\"path\":\"" + path + "\"}"));
    resp = meshsync::json::parse(w.readLine(), &ok);
    CHECK(ok && !resp.get("ok")->asBool());

    // missing path
    CHECK(w.sendLine("{\"op\":\"hash\"}"));
    resp = meshsync::json::parse(w.readLine(), &ok);
    CHECK(ok && !resp.get("ok")->asBool());

    // CRLF-tolerant request
    {
        const std::string line = "{\"op\":\"hash\",\"path\":\"" + path + "\"}\r";
        CHECK(w.sendLine(line));
        resp = meshsync::json::parse(w.readLine(), &ok);
        CHECK(ok && resp.get("ok")->asBool());
    }

    // path with a space and UTF-8 bytes (legal inside a JSON string)
    const std::string weird = tmp.file("wei rd \xE2\x9C\x93.bin");
    writeFile(weird, "spacey");
    const std::string weirdHash = Sha256::hex(reinterpret_cast<const uint8_t*>("spacey"), 6);
    CHECK(w.sendLine("{\"op\":\"hash\",\"path\":\"" + weird + "\"}"));
    resp = meshsync::json::parse(w.readLine(), &ok);
    CHECK(ok && resp.get("ok")->asBool());
    CHECK_EQ_STR(resp.get("hash")->asString(), weirdHash);

    // quit exits cleanly with status 0
    CHECK(w.sendLine("{\"op\":\"quit\"}"));
    const int rc = w.waitExit();
    CHECK(rc == 0);
}

} // namespace

int main(int argc, char** argv) {
    std::fprintf(stderr, "meshsync-native test suite\n");
    const std::string workerBin = argc >= 2 ? argv[1] : "";

    TempDir tmp;
    testSha256();
    testJson();
    testChunker();
    testFileReader(tmp);
    testFileHasher(tmp);
    testChunkHash(tmp);
    testIntegrity(tmp);
    testFileScanner(tmp);
    testWorkerProtocol(tmp, workerBin);

    std::fprintf(stderr, "\n%d checks, %d failures\n", g_checks, g_failures);
    if (g_failures == 0) {
        std::fprintf(stderr, "ALL PASS\n");
        return 0;
    }
    return 1;
}
