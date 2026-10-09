#include "meshsync/chunk_hash.hpp"

namespace meshsync {

HashResult ChunkHash::hashChunk(const std::string& path, const Chunk& chunk) {
    FileHasher hasher;
    return hasher.hashRange(path, chunk.offset, chunk.length);
}

HashResult ChunkHash::hashRange(const std::string& path, std::uint64_t offset, std::uint64_t length) {
    FileHasher hasher;
    return hasher.hashRange(path, offset, length);
}

std::vector<HashResult> ChunkHash::hashAllChunks(const std::string& path, const Chunker& chunker, std::uint64_t fileSize) {
    std::vector<HashResult> out;
    for (const Chunk& c : chunker.chunksFor(fileSize)) {
        out.push_back(hashChunk(path, c));
    }
    return out;
}

} // namespace meshsync
