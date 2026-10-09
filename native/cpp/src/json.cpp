#include "meshsync/json.hpp"

#include <cerrno>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace meshsync::json {

namespace {

class Parser {
public:
    explicit Parser(const std::string& text) : s_(text), pos_(0) {}

    bool parse(Value& out) {
        skipWs();
        if (!parseValue(out)) {
            return false;
        }
        skipWs();
        return pos_ == s_.size();
    }

private:
    void skipWs() {
        while (pos_ < s_.size()) {
            const char c = s_[pos_];
            if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
                ++pos_;
            } else {
                break;
            }
        }
    }

    bool parseValue(Value& out) {
        if (pos_ >= s_.size()) {
            return false;
        }
        const char c = s_[pos_];
        switch (c) {
        case '{':
            return parseObject(out);
        case '[':
            return parseArray(out);
        case '"':
            out = Value::makeString("");
            return parseStringBody(out.str);
        case 't':
            if (s_.compare(pos_, 4, "true") == 0) {
                pos_ += 4;
                out = Value::makeBool(true);
                return true;
            }
            return false;
        case 'f':
            if (s_.compare(pos_, 5, "false") == 0) {
                pos_ += 5;
                out = Value::makeBool(false);
                return true;
            }
            return false;
        case 'n':
            if (s_.compare(pos_, 4, "null") == 0) {
                pos_ += 4;
                out = Value();
                return true;
            }
            return false;
        default:
            return parseNumber(out);
        }
    }

    bool parseObject(Value& out) {
        out = Value::makeObject();
        ++pos_; // consume '{'
        skipWs();
        if (peek() == '}') {
            ++pos_;
            return true;
        }
        while (true) {
            skipWs();
            if (peek() != '"') {
                return false;
            }
            std::string key;
            if (!parseStringBody(key)) {
                return false;
            }
            skipWs();
            if (peek() != ':') {
                return false;
            }
            ++pos_;
            skipWs();
            Value v;
            if (!parseValue(v)) {
                return false;
            }
            out.object.emplace_back(std::move(key), std::move(v));
            skipWs();
            const char c = peek();
            if (c == ',') {
                ++pos_;
                continue;
            }
            if (c == '}') {
                ++pos_;
                return true;
            }
            return false;
        }
    }

    bool parseArray(Value& out) {
        out = Value::makeArray();
        ++pos_; // consume '['
        skipWs();
        if (peek() == ']') {
            ++pos_;
            return true;
        }
        while (true) {
            skipWs();
            Value v;
            if (!parseValue(v)) {
                return false;
            }
            out.array.push_back(std::move(v));
            skipWs();
            const char c = peek();
            if (c == ',') {
                ++pos_;
                continue;
            }
            if (c == ']') {
                ++pos_;
                return true;
            }
            return false;
        }
    }

    bool parseStringBody(std::string& out) {
        if (peek() != '"') {
            return false;
        }
        ++pos_;
        while (pos_ < s_.size()) {
            const char c = s_[pos_++];
            if (c == '"') {
                return true;
            }
            if (static_cast<unsigned char>(c) < 0x20) {
                return false; // raw control characters are invalid JSON
            }
            if (c != '\\') {
                out.push_back(c);
                continue;
            }
            if (pos_ >= s_.size()) {
                return false;
            }
            const char e = s_[pos_++];
            switch (e) {
            case '"':
                out.push_back('"');
                break;
            case '\\':
                out.push_back('\\');
                break;
            case '/':
                out.push_back('/');
                break;
            case 'b':
                out.push_back('\b');
                break;
            case 'f':
                out.push_back('\f');
                break;
            case 'n':
                out.push_back('\n');
                break;
            case 'r':
                out.push_back('\r');
                break;
            case 't':
                out.push_back('\t');
                break;
            case 'u':
                if (!parseUnicodeEscape(out)) {
                    return false;
                }
                break;
            default:
                return false;
            }
        }
        return false; // unterminated
    }

    bool parseUnicodeEscape(std::string& out) {
        if (pos_ + 4 > s_.size()) {
            return false;
        }
        std::uint32_t cp = 0;
        for (int i = 0; i < 4; ++i) {
            const char h = s_[pos_ + i];
            cp <<= 4;
            if (h >= '0' && h <= '9') {
                cp |= static_cast<std::uint32_t>(h - '0');
            } else if (h >= 'a' && h <= 'f') {
                cp |= static_cast<std::uint32_t>(h - 'a' + 10);
            } else if (h >= 'A' && h <= 'F') {
                cp |= static_cast<std::uint32_t>(h - 'A' + 10);
            } else {
                return false;
            }
        }
        pos_ += 4;

        // surrogate pair
        if (cp >= 0xD800 && cp <= 0xDBFF) {
            if (s_.compare(pos_, 6, "\\u") == 0) {
                std::uint32_t lo = 0;
                bool okLo = true;
                for (int i = 0; i < 4; ++i) {
                    const char h = s_[pos_ + 2 + i];
                    lo <<= 4;
                    if (h >= '0' && h <= '9') {
                        lo |= static_cast<std::uint32_t>(h - '0');
                    } else if (h >= 'a' && h <= 'f') {
                        lo |= static_cast<std::uint32_t>(h - 'a' + 10);
                    } else if (h >= 'A' && h <= 'F') {
                        lo |= static_cast<std::uint32_t>(h - 'A' + 10);
                    } else {
                        okLo = false;
                        break;
                    }
                }
                if (okLo && lo >= 0xDC00 && lo <= 0xDFFF) {
                    pos_ += 6;
                    cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                }
            }
        }

        // encode UTF-8
        if (cp < 0x80) {
            out.push_back(static_cast<char>(cp));
        } else if (cp < 0x800) {
            out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
            out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        } else if (cp < 0x10000) {
            out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
            out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        } else {
            out.push_back(static_cast<char>(0xF0 | (cp >> 18)));
            out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        }
        return true;
    }

    bool parseNumber(Value& out) {
        const std::size_t start = pos_;
        if (peek() == '-' || peek() == '+') {
            ++pos_;
        }
        bool isDouble = false;
        while (pos_ < s_.size()) {
            const char c = s_[pos_];
            if (c >= '0' && c <= '9') {
                ++pos_;
            } else if (c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-') {
                isDouble = true;
                ++pos_;
            } else {
                break;
            }
        }
        const std::string num = s_.substr(start, pos_ - start);
        if (num.empty() || num == "-" || num == "+") {
            return false;
        }
        if (isDouble) {
            out = Value::makeDouble(std::strtod(num.c_str(), nullptr));
            return true;
        }
        errno = 0;
        char* end = nullptr;
        const long long v = std::strtoll(num.c_str(), &end, 10);
        if (errno != 0 || (end && *end != '\0')) {
            out = Value::makeDouble(std::strtod(num.c_str(), nullptr));
            return true;
        }
        out = Value::makeInt(static_cast<std::int64_t>(v));
        return true;
    }

    char peek() const { return pos_ < s_.size() ? s_[pos_] : '\0'; }

    const std::string& s_;
    std::size_t pos_;
};

void writeString(std::string& out, const std::string& s) {
    out.push_back('"');
    out += escape(s);
    out.push_back('"');
}

void writeDouble(std::string& out, double d) {
    if (std::isnan(d) || std::isinf(d)) {
        out += "null";
        return;
    }
    char buf[64];
    std::snprintf(buf, sizeof(buf), "%.17g", d);
    out += buf;
}

} // namespace

Value Value::makeBool(bool b) {
    Value v;
    v.type = Type::Bool;
    v.boolean = b;
    return v;
}

Value Value::makeInt(std::int64_t i) {
    Value v;
    v.type = Type::Int;
    v.integer = i;
    return v;
}

Value Value::makeDouble(double d) {
    Value v;
    v.type = Type::Double;
    v.number = d;
    return v;
}

Value Value::makeString(std::string s) {
    Value v;
    v.type = Type::String;
    v.str = std::move(s);
    return v;
}

Value Value::makeArray() {
    Value v;
    v.type = Type::Array;
    return v;
}

Value Value::makeObject() {
    Value v;
    v.type = Type::Object;
    return v;
}

void Value::set(const std::string& key, Value v) {
    for (auto& kv : object) {
        if (kv.first == key) {
            kv.second = std::move(v);
            return;
        }
    }
    object.emplace_back(key, std::move(v));
}

const Value* Value::get(const std::string& key) const {
    for (const auto& kv : object) {
        if (kv.first == key) {
            return &kv.second;
        }
    }
    return nullptr;
}

std::string Value::asString(const std::string& def) const {
    return type == Type::String ? str : def;
}

std::int64_t Value::asInt(std::int64_t def) const {
    if (type == Type::Int) {
        return integer;
    }
    if (type == Type::Double) {
        return static_cast<std::int64_t>(number);
    }
    return def;
}

bool Value::asBool(bool def) const { return type == Type::Bool ? boolean : def; }

Value parse(const std::string& text, bool* ok) {
    Parser p(text);
    Value out;
    const bool good = p.parse(out);
    if (ok) {
        *ok = good;
    }
    if (!good) {
        return Value();
    }
    return out;
}

std::string escape(const std::string& s) {
    std::string out;
    out.reserve(s.size() + 8);
    for (unsigned char c : s) {
        switch (c) {
        case '"':
            out += "\\\"";
            break;
        case '\\':
            out += "\\\\";
            break;
        case '\b':
            out += "\\b";
            break;
        case '\f':
            out += "\\f";
            break;
        case '\n':
            out += "\\n";
            break;
        case '\r':
            out += "\\r";
            break;
        case '\t':
            out += "\\t";
            break;
        default:
            if (c < 0x20) {
                char buf[8];
                std::snprintf(buf, sizeof(buf), "\\u%04x", c);
                out += buf;
            } else {
                out.push_back(static_cast<char>(c));
            }
        }
    }
    return out;
}

std::string serialize(const Value& v) {
    std::string out;
    switch (v.type) {
    case Value::Type::Null:
        out += "null";
        break;
    case Value::Type::Bool:
        out += v.boolean ? "true" : "false";
        break;
    case Value::Type::Int: {
        char buf[32];
        std::snprintf(buf, sizeof(buf), "%lld", static_cast<long long>(v.integer));
        out += buf;
        break;
    }
    case Value::Type::Double:
        writeDouble(out, v.number);
        break;
    case Value::Type::String:
        writeString(out, v.str);
        break;
    case Value::Type::Array: {
        out.push_back('[');
        bool first = true;
        for (const auto& item : v.array) {
            if (!first) {
                out.push_back(',');
            }
            first = false;
            out += serialize(item);
        }
        out.push_back(']');
        break;
    }
    case Value::Type::Object: {
        out.push_back('{');
        bool first = true;
        for (const auto& kv : v.object) {
            if (!first) {
                out.push_back(',');
            }
            first = false;
            writeString(out, kv.first);
            out.push_back(':');
            out += serialize(kv.second);
        }
        out.push_back('}');
        break;
    }
    }
    return out;
}

} // namespace meshsync::json
