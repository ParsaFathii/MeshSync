// MeshSync native engine — fixed-size chunk plan for a file.
//
// MeshSync transfers files in configurable chunks (1 MiB default). The
// Chunker computes the deterministic chunk layout for a given file size:
// chunk i covers [i*chunkSize, min((i+1)*chunkSize, fileSize)). A file of
// size 0 still has one zero-length chunk so every file is addressable.
#pragma once

#include <cstdint>
#include <vector>

namespace meshsync {

struct Chunk {
    std::uint64_t index = 0;
    std::uint64_t offset = 0;
    std::uint64_t length = 0;
};

class Chunker {
public:
    static constexpr std::uint64_t kDefaultChunkSize = 1024 * 1024; // 1 MiB

    explicit Chunker(std::uint64_t chunkSize = kDefaultChunkSize);

    std::uint64_t chunkSize() const { return chunkSize_; }

    // Number of chunks covering fileSize.
    std::uint64_t chunkCount(std::uint64_t fileSize) const;

    // Full layout, chunk 0 first.
    std::vector<Chunk> chunksFor(std::uint64_t fileSize) const;

    // Chunk descriptor for an index (must be < chunkCount).
    Chunk chunkAt(std::uint64_t fileSize, std::uint64_t index) const;

private:
    std::uint64_t chunkSize_;
};

} // namespace meshsync
