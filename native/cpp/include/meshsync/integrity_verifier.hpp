// MeshSync native engine — integrity verification.
//
// Verifies a file (or a byte range of it) against an expected lowercase
// hex SHA-256. Used by the agent to confirm completed transfers and to
// detect corrupted chunks (a single flipped byte changes the digest).
#pragma once

#include "meshsync/file_hasher.hpp"

#include <string>

namespace meshsync {

class IntegrityVerifier {
public:
    struct Report {
        bool ok = false;         // content matched the expected hash
        bool exists = false;     // the file could be read at all
        std::string actualHash;  // hex digest of the content read
        std::uint64_t bytes = 0; // bytes verified
        std::string error;       // open/read error when !exists
    };

    IntegrityVerifier() = default;

    // Whole-file verification. An empty expectedHash always fails.
    Report verifyFile(const std::string& path, const std::string& expectedHex);

    // Range verification (chunk check).
    Report verifyRange(const std::string& path, std::uint64_t offset, std::uint64_t length,
                       const std::string& expectedHex);

    // Case-insensitive hex comparison with strict shape validation.
    static bool hashesEqual(const std::string& a, const std::string& b);
};

} // namespace meshsync
