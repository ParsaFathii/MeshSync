// MeshSync native engine — SHA-256 (FIPS 180-4).
//
// Self-contained C++20 implementation: no OpenSSL, no external dependencies.
// Streaming interface with an internal 64-byte block buffer so arbitrarily
// large inputs are hashed in constant memory.
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <string>

namespace meshsync {

class Sha256 {
public:
    Sha256();

    // Feed data; may be called any number of times.
    void update(const uint8_t* data, std::size_t len);
    void update(const std::string& s);

    // Finalize and return the raw 32-byte digest. The object is reset
    // afterwards and can be reused.
    std::array<uint8_t, 32> final();

    // Convenience: digest as lowercase hex.
    std::string finalHex();

    // One-shot helper.
    static std::string hex(const uint8_t* data, std::size_t len);

    static std::string toHex(const std::array<uint8_t, 32>& digest);

private:
    void processBlock(const uint8_t* block);

    uint32_t state_[8];
    uint8_t buffer_[64];
    std::size_t buflen_;
    uint64_t totalBytes_; // total message length in bytes
};

} // namespace meshsync
