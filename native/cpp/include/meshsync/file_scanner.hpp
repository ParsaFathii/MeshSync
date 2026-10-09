// MeshSync native engine — recursive directory scanner.
//
// Walks a directory tree and reports every regular file and directory with
// its path (relative to the root), size and mtime in milliseconds since the
// epoch. Symlinks are neither followed nor reported — a sync set never
// includes an indirect entry; unreadable subtrees surface as an error.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace meshsync {

struct ScanEntry {
    std::string relPath;   // path relative to the scan root, '/'-separated
    std::string absPath;   // absolute path
    bool isDir = false;
    bool isSymlink = false;
    std::uint64_t size = 0;    // bytes (files only)
    std::int64_t mtimeMs = 0;  // modification time, ms since epoch
};

class FileScanner {
public:
    // Scans root recursively. Returns false and fills error on failure.
    // Entries are sorted by relative path.
    bool scan(const std::string& root, std::vector<ScanEntry>& out, std::string& error) const;
};

} // namespace meshsync
