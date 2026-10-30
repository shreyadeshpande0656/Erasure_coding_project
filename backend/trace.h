// trace.h - writes one JSON object per line ("JSON Lines") describing what the program does.
// The web interface replays these events, so every animation comes from real program activity.
//
//   {"t":1761700000123.456,"src":"client","type":"packet_sent","seq":3,...}
//
// "t" is milliseconds since 1970 (wall clock), so events from the client and server
// processes on the same machine can be merged into one timeline.
#ifndef TRACE_H
#define TRACE_H

#include <chrono>
#include <cstdio>
#include <cstdint>
#include <sstream>
#include <string>
#include <vector>

class Trace {
public:
    Trace() : f_(NULL) {}
    ~Trace() { close(); }

    bool open(const std::string& path, const std::string& who) {
        f_ = std::fopen(path.c_str(), "wb");
        who_ = who;
        return f_ != NULL;
    }
    void close() { if (f_) { std::fclose(f_); f_ = NULL; } }
    bool on() const { return f_ != NULL; }

    // `fields` is the inside of a JSON object without braces, e.g.  "seq":3,"dropped":true
    void emit(const char* type, const std::string& fields = "") {
        if (!f_) return;
        double ms = (double)std::chrono::duration_cast<std::chrono::microseconds>(
                        std::chrono::system_clock::now().time_since_epoch()).count() / 1000.0;
        std::ostringstream o;
        o.setf(std::ios::fixed);
        o.precision(3);
        o << "{\"t\":" << ms << ",\"src\":\"" << who_ << "\",\"type\":\"" << type << "\"";
        if (!fields.empty()) o << "," << fields;
        o << "}\n";
        std::string s = o.str();
        std::fwrite(s.data(), 1, s.size(), f_);
        std::fflush(f_);
    }

    // ---- tiny JSON helpers ----
    static std::string num(unsigned long v) { std::ostringstream o; o << v; return o.str(); }
    static std::string fnum(double v) { std::ostringstream o; o << v; return o.str(); }
    static std::string str(const std::string& s) {
        std::string r = "\"";
        for (size_t i = 0; i < s.size(); i++) {
            unsigned char c = (unsigned char)s[i];
            if (c == '"' || c == '\\') { r += '\\'; r += (char)c; }
            else if (c < 32 || c > 126) r += '_';
            else r += (char)c;
        }
        return r + "\"";
    }
    static std::string arr(const std::vector<uint8_t>& v) {
        std::string r = "[";
        for (size_t i = 0; i < v.size(); i++) { if (i) r += ","; r += num(v[i]); }
        return r + "]";
    }
    static std::string hex(const uint8_t* p, size_t n, size_t max = 8) {
        const char* d = "0123456789abcdef";
        std::string r;
        for (size_t i = 0; i < n && i < max; i++) { r += d[p[i] >> 4]; r += d[p[i] & 15]; }
        return "\"" + r + "\"";
    }
    static std::string boolean(bool b) { return b ? "true" : "false"; }

private:
    FILE*       f_;
    std::string who_;
};

#endif  // TRACE_H
