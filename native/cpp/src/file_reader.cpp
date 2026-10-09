#include "meshsync/file_reader.hpp"

#include <cerrno>
#include <cstdio>
#include <cstring>
#include <sys/stat.h>

namespace meshsync {

FileReader::FileReader(const std::string& path) : path_(path) {
    f_ = std::fopen(path.c_str(), "rb");
    if (f_ == nullptr) {
        err_ = "cannot open '" + path + "': " + std::strerror(errno);
        return;
    }
    struct stat st{};
    if (::stat(path.c_str(), &st) != 0) {
        err_ = "cannot stat '" + path + "': " + std::strerror(errno);
        std::fclose(f_);
        f_ = nullptr;
        return;
    }
    if (!S_ISREG(st.st_mode)) {
        err_ = "'" + path + "' is not a regular file";
        std::fclose(f_);
        f_ = nullptr;
        return;
    }
    size_ = static_cast<std::uint64_t>(st.st_size);
}

FileReader::~FileReader() { close(); }

FileReader::FileReader(FileReader&& other) noexcept
    : f_(other.f_), path_(std::move(other.path_)), err_(std::move(other.err_)), size_(other.size_) {
    other.f_ = nullptr;
    other.size_ = 0;
}

FileReader& FileReader::operator=(FileReader&& other) noexcept {
    if (this != &other) {
        close();
        f_ = other.f_;
        path_ = std::move(other.path_);
        err_ = std::move(other.err_);
        size_ = other.size_;
        other.f_ = nullptr;
        other.size_ = 0;
    }
    return *this;
}

void FileReader::close() {
    if (f_ != nullptr) {
        std::fclose(f_);
        f_ = nullptr;
    }
}

bool FileReader::readExact(unsigned char* buf, std::size_t n) {
    if (f_ == nullptr) {
        if (err_.empty()) {
            err_ = "file not open";
        }
        return false;
    }
    std::size_t total = 0;
    while (total < n) {
        const std::size_t got = std::fread(buf + total, 1, n - total, f_);
        total += got;
        if (got == 0) {
            if (std::feof(f_)) {
                err_ = "unexpected end of file in '" + path_ + "' after " + std::to_string(total) +
                       " of " + std::to_string(n) + " bytes (file truncated?)";
            } else {
                err_ = "read error on '" + path_ + "': " + std::strerror(errno);
            }
            return false;
        }
    }
    return true;
}

std::size_t FileReader::readSome(unsigned char* buf, std::size_t n) {
    if (f_ == nullptr) {
        if (err_.empty()) {
            err_ = "file not open";
        }
        return 0;
    }
    const std::size_t got = std::fread(buf, 1, n, f_);
    if (got < n && std::ferror(f_) != 0) {
        err_ = "read error on '" + path_ + "': " + std::strerror(errno);
        return got;
    }
    return got;
}

bool FileReader::seekTo(std::uint64_t offset) {
    if (f_ == nullptr) {
        if (err_.empty()) {
            err_ = "file not open";
        }
        return false;
    }
    if (offset > static_cast<std::uint64_t>(INT64_MAX)) {
        err_ = "seek offset out of range";
        return false;
    }
    if (std::fseek(f_, static_cast<long>(offset), SEEK_SET) != 0) {
        err_ = "seek failed on '" + path_ + "': " + std::strerror(errno);
        return false;
    }
    return true;
}

} // namespace meshsync
