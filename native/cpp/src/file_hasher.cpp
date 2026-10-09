#include "meshsync/file_hasher.hpp"

#include "meshsync/file_reader.hpp"
#include "meshsync/sha256.hpp"

#include <memory>
#include <vector>

namespace meshsync {

FileHasher::FileHasher(std::size_t bufferSize)
    : bufferSize_(bufferSize < 4096 ? 4096 : bufferSize) {}

HashResult FileHasher::hashFile(const std::string& path) {
    FileReader reader(path);
    if (!reader.ok()) {
        return HashResult::failure(reader.error());
    }
    const auto start = std::chrono::steady_clock::now();

    Sha256 hasher;
    std::vector<unsigned char> buf(bufferSize_);
    std::uint64_t total = 0;
    while (true) {
        const std::size_t got = reader.readSome(buf.data(), buf.size());
        if (!reader.error().empty()) {
            return HashResult::failure(reader.error());
        }
        if (got == 0) {
            break; // clean EOF
        }
        hasher.update(buf.data(), got);
        total += got;
        if (got < buf.size()) {
            break; // EOF
        }
    }

    HashResult r;
    r.ok = true;
    r.hash = hasher.finalHex();
    r.bytes = total;
    r.ms = std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now() - start)
               .count();
    return r;
}

HashResult FileHasher::hashRange(const std::string& path, std::uint64_t offset, std::uint64_t length) {
    FileReader reader(path);
    if (!reader.ok()) {
        return HashResult::failure(reader.error());
    }
    if (!reader.seekTo(offset)) {
        return HashResult::failure(reader.error());
    }
    const auto start = std::chrono::steady_clock::now();

    Sha256 hasher;
    std::vector<unsigned char> buf(bufferSize_);
    std::uint64_t remaining = length;
    while (remaining > 0) {
        const std::size_t want = static_cast<std::size_t>(remaining < bufferSize_ ? remaining : bufferSize_);
        if (!reader.readExact(buf.data(), want)) {
            // interrupted read: truncated mid-stream
            return HashResult::failure(reader.error());
        }
        hasher.update(buf.data(), want);
        remaining -= want;
    }

    HashResult r;
    r.ok = true;
    r.hash = hasher.finalHex();
    r.bytes = length;
    r.ms = std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now() - start)
               .count();
    return r;
}

} // namespace meshsync
