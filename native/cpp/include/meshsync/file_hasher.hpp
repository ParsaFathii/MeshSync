// MeshSync native engine — streaming whole-file and range hashing.
//
// Never loads a whole file: data flows through a fixed buffer (1 MiB by
// default) into the SHA-256 state. Range hashing powers chunk verification.
#pragma once

#include <chrono>
#include <cstdint>
#include <string>

namespace meshsync {

struct HashResult {
    bool ok = false;
    std::string hash;      // lowercase hex SHA-256
    std::uint64_t bytes = 0; // bytes hashed
    std::int64_t ms = 0;     // wall-clock duration in milliseconds
    std::string error;

    static HashResult failure(std::string msg) {
        HashResult r;
        r.error = std::move(msg);
        return r;
    }
};

class FileHasher {
public:
    // bufferSize is the streaming read buffer (clamped to >= 4 KiB).
    explicit FileHasher(std::size_t bufferSize = kDefaultBuffer);

    static constexpr std::size_t kDefaultBuffer = 1024 * 1024; // 1 MiB

    // Hashes the whole file from the beginning.
    HashResult hashFile(const std::string& path);

    // Hashes exactly `length` bytes starting at `offset`. A read that hits
    // EOF before length bytes is an error (interrupted/truncated stream).
    HashResult hashRange(const std::string& path, std::uint64_t offset, std::uint64_t length);

    std::size_t bufferSize() const { return bufferSize_; }

private:
    std::size_t bufferSize_;
};

} // namespace meshsync
