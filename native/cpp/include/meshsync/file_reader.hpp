// MeshSync native engine — RAII streaming file reader.
//
// Thin, error-checked wrapper over std::FILE with positional reads.
// Every failure sets a human-readable error message; callers never
// need to inspect errno directly.
#pragma once

#include <cstdint>
#include <string>

namespace meshsync {

class FileReader {
public:
    // Opens the file for reading. On failure ok() is false and error()
    // explains why; all read operations become no-ops.
    explicit FileReader(const std::string& path);
    ~FileReader();

    FileReader(const FileReader&) = delete;
    FileReader& operator=(const FileReader&) = delete;
    FileReader(FileReader&& other) noexcept;
    FileReader& operator=(FileReader&& other) noexcept;

    bool ok() const { return f_ != nullptr; }
    const std::string& error() const { return err_; }
    std::uint64_t size() const { return size_; }
    const std::string& path() const { return path_; }

    // Reads exactly n bytes into buf. Returns false (with error set) on a
    // short read or I/O failure — an interrupted/truncated stream is an
    // error, never silently accepted.
    bool readExact(unsigned char* buf, std::size_t n);

    // Reads up to n bytes; returns bytes read (can be 0 at EOF).
    // Errors set error() and return with ok() false.
    std::size_t readSome(unsigned char* buf, std::size_t n);

    // Absolute seek (from start of file).
    bool seekTo(std::uint64_t offset);

    void close();

private:
    std::FILE* f_ = nullptr;
    std::string path_;
    std::string err_;
    std::uint64_t size_ = 0;
};

} // namespace meshsync
