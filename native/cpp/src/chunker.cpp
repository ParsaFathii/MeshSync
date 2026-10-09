#include "meshsync/chunker.hpp"

namespace meshsync {

Chunker::Chunker(std::uint64_t chunkSize)
    : chunkSize_(chunkSize == 0 ? kDefaultChunkSize : chunkSize) {}

std::uint64_t Chunker::chunkCount(std::uint64_t fileSize) const {
    if (fileSize == 0) {
        return 1; // one empty chunk keeps every file addressable
    }
    return (fileSize + chunkSize_ - 1) / chunkSize_;
}

std::vector<Chunk> Chunker::chunksFor(std::uint64_t fileSize) const {
    const std::uint64_t n = chunkCount(fileSize);
    std::vector<Chunk> out;
    out.reserve(static_cast<std::size_t>(n));
    for (std::uint64_t i = 0; i < n; ++i) {
        out.push_back(chunkAt(fileSize, i));
    }
    return out;
}

Chunk Chunker::chunkAt(std::uint64_t fileSize, std::uint64_t index) const {
    Chunk c;
    c.index = index;
    c.offset = index * chunkSize_;
    const std::uint64_t end = (index + 1) * chunkSize_;
    c.length = end > fileSize ? (fileSize > c.offset ? fileSize - c.offset : 0) : chunkSize_;
    return c;
}

} // namespace meshsync
