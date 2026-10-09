// MeshSync native engine — per-chunk SHA-256.
//
// Computes the digest of one chunk (byte range) of a file, the unit of
// integrity MeshSync verifies on the wire.
#pragma once

#include "meshsync/chunker.hpp"
#include "meshsync/file_hasher.hpp"

#include <string>
#include <vector>

namespace meshsync {

class ChunkHash {
public:
    ChunkHash() = default;

    // Hash of one chunk of a file.
    HashResult hashChunk(const std::string& path, const Chunk& chunk);

    // Hash of an explicit byte range.
    HashResult hashRange(const std::string& path, std::uint64_t offset, std::uint64_t length);

    // Hash every chunk of a file per the given chunker layout.
    std::vector<HashResult> hashAllChunks(const std::string& path, const Chunker& chunker, std::uint64_t fileSize);
};

} // namespace meshsync
