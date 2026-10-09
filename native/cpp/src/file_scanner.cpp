#include "meshsync/file_scanner.hpp"

#include <algorithm>
#include <chrono>
#include <filesystem>

namespace fs = std::filesystem;

namespace meshsync {

namespace {

std::int64_t toMtimeMs(const fs::file_time_type& t) {
    // file_time_clock epoch differs from the system clock; convert via the
    // system clock (microsecond precision is more than enough here).
    const auto sys = std::chrono::time_point_cast<std::chrono::milliseconds>(
        t - fs::file_time_type::clock::now() + std::chrono::system_clock::now());
    return sys.time_since_epoch().count();
}

} // namespace

bool FileScanner::scan(const std::string& root, std::vector<ScanEntry>& out, std::string& error) const {
    out.clear();
    std::error_code ec;
    const fs::path rootPath(root);
    if (!fs::exists(rootPath, ec) || !fs::is_directory(rootPath, ec)) {
        error = "'" + root + "' is not an existing directory";
        return false;
    }
    fs::recursive_directory_iterator it(rootPath, fs::directory_options::skip_permission_denied, ec);
    if (ec) {
        error = "cannot scan '" + root + "': " + ec.message();
        return false;
    }
    fs::recursive_directory_iterator end;
    while (it != end) {
        std::error_code entryEc;
        const fs::path& p = it->path();
        const bool isSymlink = it->is_symlink(entryEc);

        ScanEntry e;
        e.absPath = p.string();
        std::error_code relEc;
        fs::path rel = fs::relative(p, rootPath, relEc);
        e.relPath = relEc ? p.filename().string() : rel.generic_string();
        e.isSymlink = isSymlink;

        if (it->is_directory(entryEc) && !isSymlink) {
            e.isDir = true;
            out.push_back(std::move(e));
        } else if (it->is_regular_file(entryEc) && !isSymlink) {
            std::error_code szEc;
            e.size = static_cast<std::uint64_t>(it->file_size(szEc));
            e.mtimeMs = toMtimeMs(it->last_write_time(entryEc));
            out.push_back(std::move(e));
        }

        if (entryEc) {
            error = "error scanning '" + p.string() + "': " + entryEc.message();
            return false;
        }

        it.increment(entryEc);
        if (entryEc) {
            error = "error scanning '" + root + "': " + entryEc.message();
            return false;
        }
    }
    std::sort(out.begin(), out.end(),
              [](const ScanEntry& a, const ScanEntry& b) { return a.relPath < b.relPath; });
    return true;
}

} // namespace meshsync
