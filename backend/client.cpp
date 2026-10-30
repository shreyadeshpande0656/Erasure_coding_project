// client.cpp - erasure-coded UDP file sender.
//
//   client <server_ip> <port> <file> [options]
//
//   --redundancy R   send ceil(K*R) packets up front (default 1.5; 1.0 = plain, no spare)
//   --block N        block size in bytes (default: 1024, raised automatically for big files)
//   --loss P         simulate packet loss: drop each outgoing packet with probability P (0..0.99)
//   --corrupt P      flip one random bit in a packet with probability P (tests the CRC check)
//   --seed S         seed of the loss/corruption simulator (same seed = same pattern)
//   --rate N         pacing in packets per second (default 3000, 0 = as fast as possible)
//   --max-extra N    after the first batch, how many EXTRA repair packets may be sent while
//                    waiting for the server's DONE (default 5*K+200; 0 = never send more)
//   --timeout S      give up after S seconds (default 30)
//   --delay-meta N   send the metadata packet only after N data packets (tests "data before META")
//   --k N            cut the file into exactly N blocks (block size = ceil(size / N))
//   --coded          fully coded mode: EVERY packet is a random mixture (no plain source packets)
//   --latency MS     emulate a one-way network delay: packets leave MS ms after they are "sent",
//                    and the server's DONE is only noticed MS ms after it arrives
//   --jitter MS      random extra delay 0..MS per packet (this reorders packets)
//   --reliable-meta  the simulator never drops the metadata packet (demo: only DATA is lost)
//   --trace FILE     write a JSON-lines event log (used by the web interface)
//
// The code is rateless: any packet number seq can be generated at any time, so if the
// server is not done yet, the client simply keeps sending fresh repair packets.
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <random>
#include <string>
#include <vector>

#include "coding.h"
#include "net_compat.h"
#include "packet.h"
#include "sha256.h"
#include "trace.h"

typedef std::chrono::steady_clock Clock;

static double elapsed(Clock::time_point t0) {
    return std::chrono::duration<double>(Clock::now() - t0).count();
}

// ---------------------------------------------------------------------------
// command line
// ---------------------------------------------------------------------------
struct Options {
    std::string    ip, path;
    unsigned short port       = 0;
    uint32_t       block      = 0;        // 0 = automatic
    double         redundancy = 1.5;
    double         loss       = 0.0;
    double         corrupt    = 0.0;
    uint32_t       seed       = 1;
    int            rate       = 3000;
    long           max_extra  = -1;       // -1 = automatic
    double         timeout    = 30.0;
    uint32_t       delay_meta = 0;
    uint32_t       k_target   = 0;        // --k
    bool           coded      = false;    // --coded
    double         latency    = 0.0;      // ms
    double         jitter     = 0.0;      // ms
    bool           reliable_meta = false;
    std::string    trace;
};

static void usage() {
    std::printf(
        "usage: client <server_ip> <port> <file> [options]\n"
        "  --redundancy R   packets sent up front = ceil(K*R)        (default 1.5)\n"
        "  --block N        block size in bytes                      (default 1024, auto-raised)\n"
        "  --loss P         simulated loss probability 0..0.99       (default 0)\n"
        "  --corrupt P      simulated bit-flip probability 0..1      (default 0)\n"
        "  --seed S         seed of the loss simulator               (default 1)\n"
        "  --rate N         packets per second, 0 = unlimited        (default 3000)\n"
        "  --max-extra N    extra repair packets allowed after the first batch (0 = none)\n"
        "  --timeout S      give up after S seconds                  (default 30)\n"
        "  --delay-meta N   send metadata only after N data packets  (default 0)\n"
        "  --k N            cut the file into exactly N blocks\n"
        "  --coded          every packet is a random mixture (no plain packets)\n"
        "  --latency MS     emulated one-way network delay in ms     (default 0)\n"
        "  --jitter MS      random extra delay 0..MS (reorders packets)\n"
        "  --reliable-meta  never drop the metadata packet in the simulator\n"
        "  --trace FILE     write a JSON-lines event log\n"
        "example: client 127.0.0.1 9000 tests/sample.bin --loss 0.3\n");
}

static bool parse_args(int argc, char** argv, Options& o) {
    int pos = 0;
    for (int i = 1; i < argc; i++) {
        std::string a = argv[i];
        if (a == "--coded") { o.coded = true; continue; }
        if (a == "--reliable-meta") { o.reliable_meta = true; continue; }
        if (a.size() > 2 && a[0] == '-' && a[1] == '-') {
            if (i + 1 >= argc) { std::printf("missing value for %s\n", a.c_str()); return false; }
            const char* v = argv[++i];
            if      (a == "--redundancy") o.redundancy = std::atof(v);
            else if (a == "--block")      o.block      = (uint32_t)std::atoi(v);
            else if (a == "--loss")       o.loss       = std::atof(v);
            else if (a == "--corrupt")    o.corrupt    = std::atof(v);
            else if (a == "--seed")       o.seed       = (uint32_t)std::atoi(v);
            else if (a == "--rate")       o.rate       = std::atoi(v);
            else if (a == "--max-extra")  o.max_extra  = std::atol(v);
            else if (a == "--timeout")    o.timeout    = std::atof(v);
            else if (a == "--delay-meta") o.delay_meta = (uint32_t)std::atoi(v);
            else if (a == "--k")          o.k_target   = (uint32_t)std::atoi(v);
            else if (a == "--latency")    o.latency    = std::atof(v);
            else if (a == "--jitter")     o.jitter     = std::atof(v);
            else if (a == "--trace")      o.trace      = v;
            else { std::printf("unknown option %s\n", a.c_str()); return false; }
        } else {
            if      (pos == 0) o.ip   = a;
            else if (pos == 1) o.port = (unsigned short)std::atoi(a.c_str());
            else if (pos == 2) o.path = a;
            else { std::printf("unexpected argument %s\n", a.c_str()); return false; }
            pos++;
        }
    }
    if (pos != 3) return false;
    if (o.port == 0)                                  { std::printf("bad port\n"); return false; }
    if (o.redundancy < 1.0)                           { std::printf("--redundancy must be >= 1.0\n"); return false; }
    if (o.loss < 0.0 || o.loss > 0.99)                { std::printf("--loss must be in 0..0.99\n"); return false; }
    if (o.corrupt < 0.0 || o.corrupt > 1.0)           { std::printf("--corrupt must be in 0..1\n"); return false; }
    if (o.block > pkt::MAX_BLOCK)                     { std::printf("--block must be <= %lu\n", (unsigned long)pkt::MAX_BLOCK); return false; }
    if (o.rate < 0 || o.timeout <= 0.0)               { std::printf("bad --rate or --timeout\n"); return false; }
    return true;
}

static bool read_file(const std::string& path, std::vector<uint8_t>& out) {
    FILE* f = std::fopen(path.c_str(), "rb");
    if (!f) return false;
    out.clear();
    uint8_t buf[65536];
    size_t n;
    while ((n = std::fread(buf, 1, sizeof(buf), f)) > 0) out.insert(out.end(), buf, buf + n);
    std::fclose(f);
    return true;
}

static std::string base_name(const std::string& p) {
    size_t pos = p.find_last_of("/\\");
    return pos == std::string::npos ? p : p.substr(pos + 1);
}

// ---------------------------------------------------------------------------
// sender: loss/corruption simulation, pacing, counters
// ---------------------------------------------------------------------------
struct Delayed {                        // a packet waiting for its (emulated) network delay
    Clock::time_point    due;
    std::vector<uint8_t> bytes;
};

struct Tx {
    sock_t              s;
    sockaddr_in         dst;
    std::mt19937        rng;
    double              loss, corrupt;
    int                 rate;
    double              latency_ms, jitter_ms;
    bool                reliable_meta;
    Trace*              tr;
    uint32_t            attempted, dropped, corrupted, transmitted;
    unsigned long       bytes;
    Clock::time_point   pace_base;
    uint32_t            pace_n;
    std::vector<Delayed> queue;

    Tx(sock_t sock, const sockaddr_in& d, uint32_t seed, double l, double c, int r,
       double lat, double jit, bool rel, Trace* t)
        : s(sock), dst(d), rng(seed), loss(l), corrupt(c), rate(r),
          latency_ms(lat), jitter_ms(jit), reliable_meta(rel), tr(t),
          attempted(0), dropped(0), corrupted(0), transmitted(0), bytes(0),
          pace_base(Clock::now()), pace_n(0) {}

    // Own mapping (not std::uniform_real_distribution) so that the same --seed gives the
    // same loss pattern with every compiler and OS.
    double rnd() { return (double)(rng() & 0xFFFFFF) / 16777216.0; }

    // seq < 0 means "metadata packet". The loss simulator decides here whether the packet
    // is dropped, corrupted or delivered; delivered packets wait for their emulated delay.
    void send(const std::vector<uint8_t>& packet, long seq) {
        attempted++;
        const bool is_meta = seq < 0;
        bool drop = loss > 0.0 && !(is_meta && reliable_meta) && rnd() < loss;
        std::vector<uint8_t> b = packet;
        bool flip = false;
        if (!drop && corrupt > 0.0 && rnd() < corrupt) {
            size_t idx = rng() % b.size();
            b[idx] ^= (uint8_t)(1u << (rng() % 8));
            flip = true;
        }
        double delay = latency_ms + (jitter_ms > 0.0 ? rnd() * jitter_ms : 0.0);
        if (tr) {
            std::string f = "\"seq\":" + Trace::fnum((double)seq) + ",\"kind\":\"" + (is_meta ? "meta" : "data") +
                            "\",\"dropped\":" + Trace::boolean(drop) + ",\"corrupted\":" + Trace::boolean(flip) +
                            ",\"delay_ms\":" + Trace::fnum(delay) + ",\"bytes\":" + Trace::num(b.size());
            tr->emit(is_meta ? "meta_sent" : "packet_sent", f);
            if (drop) tr->emit("packet_dropped", "\"seq\":" + Trace::fnum((double)seq) + ",\"kind\":\"" + (is_meta ? "meta" : "data") + "\"");
        }
        if (drop) { dropped++; return; }
        if (flip) corrupted++;
        Delayed d;
        d.due = Clock::now() + std::chrono::microseconds((long long)(delay * 1000.0));
        d.bytes = b;
        queue.push_back(d);
        transmitted++;
        bytes += (unsigned long)b.size();
        flush();
    }

    // Put every packet whose emulated delay has passed on the wire, earliest first.
    void flush() {
        for (;;) {
            Clock::time_point now = Clock::now();
            size_t best = queue.size();
            for (size_t i = 0; i < queue.size(); i++)
                if (queue[i].due <= now && (best == queue.size() || queue[i].due < queue[best].due)) best = i;
            if (best == queue.size()) return;
            int r = sendto(s, (const char*)queue[best].bytes.data(), (int)queue[best].bytes.size(), 0,
                           (sockaddr*)&dst, sizeof(dst));
            if (r < 0) {
                static bool warned = false;
                if (!warned) { std::printf("sendto() failed: %d\n", net_errno()); warned = true; }
            }
            queue.erase(queue.begin() + (long)best);
        }
    }
    void drain() {                       // finish delivering packets that are still "in the network"
        Clock::time_point t = Clock::now();
        while (!queue.empty() && elapsed(t) < 5.0) { flush(); sleep_us(1000); }
    }

    void pace_reset() { pace_base = Clock::now(); pace_n = 0; }
    void pace() {
        if (rate <= 0) { flush(); return; }
        pace_n++;
        double target = (double)pace_n / (double)rate;
        for (;;) {
            flush();
            double now = elapsed(pace_base);
            if (target <= now) break;
            double left = target - now;
            sleep_us((unsigned)(left > 0.001 ? 1000 : left * 1e6));
        }
    }
};

struct Reply {
    bool              got    = false;     // DONE has been noticed (after the emulated ack delay)
    bool              seen   = false;     // DONE has arrived on the socket
    uint8_t           status = 0;
    uint32_t          used   = 0;
    Clock::time_point seen_at;
};

// Non-blocking: drain the socket, look for our DONE. The DONE only counts after the
// emulated network delay (latency) has passed, like a real ack that travels back.
static bool poll_done(sock_t s, uint32_t file_id, Reply& r, double latency_ms, Trace* tr) {
    char rbuf[2048];
    for (;;) {
        int n = recvfrom(s, rbuf, sizeof(rbuf), 0, NULL, NULL);
        if (n < 0) break;                             // nothing (more) to read
        pkt::Packet p;
        if (pkt::decode((const uint8_t*)rbuf, (size_t)n, p) == pkt::PKT_OK &&
            p.type == pkt::T_DONE && p.file_id == file_id && !r.seen) {
            r.seen = true; r.seen_at = Clock::now(); r.status = p.status; r.used = p.packets_used;
        }
    }
    if (r.seen && !r.got && elapsed(r.seen_at) * 1000.0 >= latency_ms) {
        r.got = true;
        if (tr) tr->emit("ack_received", "\"status\":" + Trace::num(r.status) + ",\"packets_used\":" + Trace::num(r.used));
    }
    return r.got;
}

static bool wait_done(Tx& tx, uint32_t file_id, Reply& r, double seconds, double latency_ms, Trace* tr) {
    Clock::time_point t = Clock::now();
    while (elapsed(t) < seconds) {
        tx.flush();
        if (poll_done(tx.s, file_id, r, latency_ms, tr)) return true;
        sleep_us(1000);
    }
    return poll_done(tx.s, file_id, r, latency_ms, tr);
}

// ---------------------------------------------------------------------------
int main(int argc, char** argv) {
    std::setvbuf(stdout, NULL, _IONBF, 0);

    Options o;
    if (!parse_args(argc, argv, o)) { usage(); return 2; }

    Trace tr;
    if (!o.trace.empty() && !tr.open(o.trace, "client")) {
        std::printf("cannot write trace file '%s'\n", o.trace.c_str());
        return 2;
    }

    // ---- 1. read the file ----
    std::vector<uint8_t> data;
    if (!read_file(o.path, data)) { std::printf("cannot read '%s'\n", o.path.c_str()); return 2; }
    if (data.empty()) { std::printf("'%s' is empty; empty files are not supported\n", o.path.c_str()); return 2; }

    // ---- 2. block size, encoder ----
    // @snippet split
    // Cut the file into K blocks. If the caller asked for exactly N blocks (--k N), the
    // block size is ceil(size / N); the last block is padded with zeros up to that size.
    uint32_t bs = o.block;
    if (bs == 0 && o.k_target > 0) {
        bs = (uint32_t)((data.size() + o.k_target - 1) / o.k_target);
    }
    if (bs == 0) {
        bs = (uint32_t)pkt::DEFAULT_BLOCK;
        if (coding::blocks_needed(data.size(), bs) > coding::MAX_K) {
            uint64_t need = (data.size() + coding::MAX_K - 1) / coding::MAX_K;
            if (need > pkt::MAX_BLOCK) bs = 0;
            else                       bs = (uint32_t)need;
        }
    }
    if (bs > pkt::MAX_BLOCK) {
        std::printf("block size %lu is above the packet limit of %lu bytes (file too big for --k %lu)\n",
                    (unsigned long)bs, (unsigned long)pkt::MAX_BLOCK, (unsigned long)o.k_target);
        return 2;
    }
    // @end
    const bool systematic = !o.coded;
    coding::Encoder enc(data.data(), data.size(), bs ? bs : 1, systematic);
    if (bs == 0 || !enc.ok()) {
        std::printf("file too large: at most %lu bytes (K <= %lu blocks of <= %lu bytes) "
                    "until generation-based coding is added\n",
                    (unsigned long)((uint64_t)coding::MAX_K * pkt::MAX_BLOCK),
                    (unsigned long)coding::MAX_K, (unsigned long)pkt::MAX_BLOCK);
        return 2;
    }
    const uint32_t K = enc.k();
    uint32_t N = (uint32_t)std::ceil((double)K * o.redundancy);
    if (N < K) N = K;
    const uint32_t file_crc = crc32(data.data(), data.size());
    const std::string file_sha = sha256_hex(data.data(), data.size());
    const std::string name = base_name(o.path);

    uint64_t tnow = (uint64_t)std::chrono::system_clock::now().time_since_epoch().count();
    const uint32_t file_id = (uint32_t)(tnow ^ (tnow >> 32) ^ 0x9E3779B9u);

    // ---- 3. socket ----
    if (!net_init()) { std::printf("network init failed\n"); return 2; }
    sock_t s = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (s == SOCK_BAD) { std::printf("socket() failed: %d\n", net_errno()); return 2; }
    sock_disable_udp_connreset(s);
    sock_set_nonblocking(s, true);
    sockaddr_in dst;
    if (!make_addr(dst, o.ip.c_str(), o.port)) {
        std::printf("bad server address '%s' (use a numeric IP such as 127.0.0.1)\n", o.ip.c_str());
        return 2;
    }

    std::printf("sending '%s' (%lu bytes) to %s:%u\n", name.c_str(), (unsigned long)data.size(),
                o.ip.c_str(), (unsigned)o.port);
    std::printf("  K = %lu blocks of %lu bytes, file id %08lX, file crc32 %08lX\n",
                (unsigned long)K, (unsigned long)bs, (unsigned long)file_id, (unsigned long)file_crc);
    std::printf("  first batch: %lu packets (redundancy %.2f), simulated loss %.0f%%, corruption %.0f%%, mode %s\n",
                (unsigned long)N, o.redundancy, o.loss * 100.0, o.corrupt * 100.0,
                systematic ? "systematic" : "fully coded");

    {
        // file id as 8 hex digits
        const char* dg = "0123456789ABCDEF";
        std::string idhex;
        for (int i = 7; i >= 0; i--) idhex += dg[(file_id >> (4 * i)) & 0xF];
        std::string f = "\"name\":" + Trace::str(name) + ",\"size\":" + Trace::num((unsigned long)data.size()) +
            ",\"k\":" + Trace::num(K) + ",\"block\":" + Trace::num(bs) +
            ",\"padding\":" + Trace::num((unsigned long)((uint64_t)K * bs - data.size())) +
            ",\"file_id\":" + Trace::str(idhex) + ",\"crc32\":" + Trace::num(file_crc) +
            ",\"sha256\":" + Trace::str(file_sha) + ",\"mode\":" + Trace::str(systematic ? "systematic" : "coded") +
            ",\"first_batch\":" + Trace::num(N) + ",\"loss\":" + Trace::fnum(o.loss) +
            ",\"latency_ms\":" + Trace::fnum(o.latency) + ",\"jitter_ms\":" + Trace::fnum(o.jitter);
        tr.emit("file_split", f);
        // the K source blocks, so the Encoding tab can show them
        for (uint32_t i = 0; i < K; i++) {
            size_t off = (size_t)i * bs;
            size_t n = off < data.size() ? (data.size() - off < bs ? data.size() - off : bs) : 0;
            tr.emit("block_created", "\"index\":" + Trace::num(i) + ",\"bytes\":" + Trace::num(bs) +
                    ",\"data_bytes\":" + Trace::num((unsigned long)n) + ",\"preview\":" + Trace::hex(data.data() + off, n, 12));
        }
    }

    Tx tx(s, dst, o.seed, o.loss, o.corrupt, o.rate, o.latency, o.jitter, o.reliable_meta, tr.on() ? &tr : NULL);
    Reply reply;
    uint32_t seq = 0;                 // next packet number to generate (0..K-1 source, K.. repair)
    uint32_t meta_sent = 0;
    std::vector<uint8_t> payload(bs);
    std::vector<uint8_t> coef(K);

    auto send_meta = [&](int copies) {
        std::vector<uint8_t> m = pkt::encode(
            pkt::make_meta(file_id, data.size(), (uint16_t)bs, K, file_crc, name, systematic ? 0 : 1));
        for (int c = 0; c < copies; c++) { tx.send(m, -1); meta_sent++; }
    };
    auto send_data = [&]() {
        // @snippet encode_packet
        // Packet `seq` = sum over all blocks of (coefficient * block), in GF(256).
        enc.encode(file_id, seq, payload.data());
        // @end
        if (tr.on()) {
            coding::make_coeffs(file_id, seq, K, coef.data(), systematic);
            tr.emit("packet_encoded", "\"seq\":" + Trace::num(seq) + ",\"coefs\":" + Trace::arr(coef) +
                    ",\"payload\":" + Trace::hex(payload.data(), bs, 12) + ",\"len\":" + Trace::num(bs));
        }
        tx.send(pkt::encode(pkt::make_data(file_id, seq, payload.data(), bs)), (long)seq);
        seq++;
    };
    // metadata: a burst at the start (or at --delay-meta), then one copy every 32 packets
    auto meta_due = [&](uint32_t i) {
        if (i == o.delay_meta) send_meta(3);
        else if (i > o.delay_meta && (i - o.delay_meta) % 32 == 0) send_meta(1);
    };
    auto poll = [&]() { return poll_done(s, file_id, reply, o.latency, tr.on() ? &tr : NULL); };

    Clock::time_point t0 = Clock::now();

    // ---- 4. first batch ----
    tx.pace_reset();
    for (uint32_t i = 0; i < N && !reply.got; i++) {
        meta_due(seq);
        send_data();
        tx.pace();
        poll();
    }

    // ---- 5. not done yet: keep sending fresh repair packets until DONE ----
    uint32_t extra_cap = (o.max_extra >= 0) ? (uint32_t)o.max_extra : 5 * K + 200;
    uint32_t extra = 0;
    int      rounds = 0;
    double   idle_after_cap = 0.0;
    while (!reply.got && elapsed(t0) < o.timeout) {
        // Short pauses: DONE normally arrives within a few ms, and the longer we wait,
        // the longer a transfer that needs top-up packets takes. The pause grows a bit
        // so a slow-to-decode server is not flooded.
        double w = 0.05 + 0.03 * rounds;
        if (w > 0.25) w = 0.25;
        rounds++;
        if (wait_done(tx, file_id, reply, w, o.latency, tr.on() ? &tr : NULL)) break;
        if (extra >= extra_cap) {
            idle_after_cap += w;
            if (idle_after_cap >= 1.5 + (o.latency + o.jitter) / 1000.0) break;   // nothing more to send, stop waiting
            continue;
        }
        send_meta(1);
        uint32_t batch = K / 10 > 16 ? K / 10 : 16;
        tx.pace_reset();
        for (uint32_t b = 0; b < batch && extra < extra_cap && !reply.got; b++) {
            send_data();
            extra++;
            tx.pace();
            poll();
        }
    }
    double secs = elapsed(t0);
    tx.drain();                       // packets still "in the network" are delivered anyway

    // ---- 6. report ----
    const uint32_t generated = seq;
    std::printf("\n---- client summary ----\n");
    std::printf("data packets generated : %lu  (planned first batch %lu, extra top-up packets %lu)\n",
                (unsigned long)generated, (unsigned long)N, (unsigned long)extra);
    std::printf("metadata packets       : %lu\n", (unsigned long)meta_sent);
    std::printf("dropped by simulator   : %lu of %lu  (%.1f%%)\n", (unsigned long)tx.dropped,
                (unsigned long)tx.attempted,
                tx.attempted ? 100.0 * tx.dropped / tx.attempted : 0.0);
    if (tx.corrupted) std::printf("corrupted on purpose   : %lu\n", (unsigned long)tx.corrupted);
    std::printf("sent on the network    : %lu packets, %lu bytes\n",
                (unsigned long)tx.transmitted, tx.bytes);
    std::printf("time                   : %.2f s  (%.0f KB/s of file data)\n", secs,
                secs > 0 ? data.size() / 1024.0 / secs : 0.0);

    int rc;
    if (reply.got && reply.status == 1) {
        std::printf("server reply           : DONE, file rebuilt and CRC ok (decoder used %lu packets for K = %lu)\n",
                    (unsigned long)reply.used, (unsigned long)K);
        rc = 0;
    } else if (reply.got) {
        std::printf("server reply           : DONE but the rebuilt file FAILED the CRC check\n");
        rc = 1;
    } else {
        std::printf("server reply           : none (server not running, or too many packets lost)\n");
        rc = 1;
    }
    std::printf("RESULT role=client ok=%d K=%lu block=%lu generated=%lu dropped=%lu transmitted=%lu time=%.3f\n",
                rc == 0 ? 1 : 0, (unsigned long)K, (unsigned long)bs, (unsigned long)generated,
                (unsigned long)tx.dropped, (unsigned long)tx.transmitted, secs);
    tr.emit("client_stop", std::string("\"ok\":") + Trace::boolean(rc == 0) + ",\"generated\":" + Trace::num(generated) +
            ",\"dropped\":" + Trace::num(tx.dropped) + ",\"transmitted\":" + Trace::num(tx.transmitted) +
            ",\"reason\":" + Trace::str(reply.got ? "ack received" : "no ack"));

    sock_close(s);
    net_cleanup();
    return rc;
}
