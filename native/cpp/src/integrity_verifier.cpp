#include "meshsync/integrity_verifier.hpp"

namespace meshsync {

namespace {

bool isHexSha256(const std::string& s) {
    if (s.size() != 64) {
        return false;
    }
    for (char c : s) {
        const bool ok = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
        if (!ok) {
            return false;
        }
    }
    return true;
}

char lowerHex(char c) {
    if (c >= 'A' && c <= 'F') {
        return static_cast<char>(c - 'A' + 'a');
    }
    return c;
}

} // namespace

IntegrityVerifier::Report IntegrityVerifier::verifyFile(const std::string& path, const std::string& expectedHex) {
    Report rep;
    if (!isHexSha256(expectedHex)) {
        rep.error = "expected hash is not a 64-char hex SHA-256";
        return rep;
    }
    FileHasher hasher;
    HashResult r = hasher.hashFile(path);
    if (!r.ok) {
        rep.error = r.error;
        return rep;
    }
    rep.exists = true;
    rep.actualHash = r.hash;
    rep.bytes = r.bytes;
    rep.ok = hashesEqual(r.hash, expectedHex);
    if (!rep.ok) {
        rep.error = "hash mismatch";
    }
    return rep;
}

IntegrityVerifier::Report IntegrityVerifier::verifyRange(const std::string& path, std::uint64_t offset,
                                                          std::uint64_t length, const std::string& expectedHex) {
    Report rep;
    if (!isHexSha256(expectedHex)) {
        rep.error = "expected hash is not a 64-char hex SHA-256";
        return rep;
    }
    FileHasher hasher;
    HashResult r = hasher.hashRange(path, offset, length);
    if (!r.ok) {
        rep.error = r.error;
        return rep;
    }
    rep.exists = true;
    rep.actualHash = r.hash;
    rep.bytes = r.bytes;
    rep.ok = hashesEqual(r.hash, expectedHex);
    if (!rep.ok) {
        rep.error = "hash mismatch";
    }
    return rep;
}

bool IntegrityVerifier::hashesEqual(const std::string& a, const std::string& b) {
    if (a.size() != b.size()) {
        return false;
    }
    for (std::size_t i = 0; i < a.size(); ++i) {
        if (lowerHex(a[i]) != lowerHex(b[i])) {
            return false;
        }
    }
    return true;
}

} // namespace meshsync
