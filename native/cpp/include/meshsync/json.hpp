// MeshSync native engine — minimal JSON parser/serializer.
//
// Hand-rolled, allocation-light JSON sufficient for the worker's
// line protocol: objects, arrays, strings with full escape support
// (including \uXXXX decoded to UTF-8), 64-bit integers, doubles,
// booleans and null. Object member order is preserved on round-trip.
#pragma once

#include <cstdint>
#include <map>
#include <string>
#include <vector>

namespace meshsync::json {

class Value {
public:
    enum class Type { Null, Bool, Int, Double, String, Array, Object };

    Type type = Type::Null;
    bool boolean = false;
    std::int64_t integer = 0;
    double number = 0.0;
    std::string str;
    std::vector<Value> array;
    std::vector<std::pair<std::string, Value>> object; // ordered members

    Value() = default;
    static Value makeBool(bool b);
    static Value makeInt(std::int64_t i);
    static Value makeDouble(double d);
    static Value makeString(std::string s);
    static Value makeArray();
    static Value makeObject();

    bool isNull() const { return type == Type::Null; }

    // Object helpers (no-op when not an object or key missing).
    void set(const std::string& key, Value v);
    const Value* get(const std::string& key) const;

    // Typed getters with defaults.
    std::string asString(const std::string& def = "") const;
    std::int64_t asInt(std::int64_t def = 0) const;
    bool asBool(bool def = false) const;
};

// Parses one complete JSON document. On failure returns a Null value and
// sets *ok (when non-null) to false. Trailing whitespace is allowed,
// trailing garbage is not.
Value parse(const std::string& text, bool* ok = nullptr);

// Compact serialization (no spaces). Strings are escaped safely.
std::string serialize(const Value& v);

// Escapes a raw string into a JSON string literal body (no quotes added).
std::string escape(const std::string& s);

} // namespace meshsync::json
