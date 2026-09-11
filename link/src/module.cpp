/*
 * fsc-editor-link — the Link module.
 *
 * The only code of ours that runs inside the simulator, and it exists for one
 * capability nothing else can provide: `L:` variables. They are 84% of the
 * profile corpus, there is no client-side way to read them, and enumerating
 * them needs `fsVarsGetLVarName`, which only exists in here.
 *
 * What it does, and nothing more:
 *
 *   - enumerate `L:` once, and send the names
 *   - read every one by cached id each tick, and send what changed
 *   - hold a watch set of `Z:` and `E:` names, resolved to typed ids and
 *     read on the same tick with the same deadband, values on the same wire
 *   - answer a handshake with its version
 *   - run a line of calculator code when asked, and say whether it ran
 *   - answer `probe`, a one-time question about the typed variable API that
 *     the watch set above was designed against
 *
 * The last one is the app's `set:` lines, and it is a *conduit* rather than a
 * new capability: the app resolves the expression, the sim's own calculator
 * parses the code, and this decides nothing about either. Which is why it is
 * `execute_calculator_code` and not `fsVarsLVarSet` — a setter emits arbitrary
 * calculator code, and only the calculator knows what it means.
 *
 * What it deliberately does not do: interpret, rank, correlate, or decide what
 * matters. Those are the app's, computed over the stream — the same split the
 * SimConnect client keeps, for the same reason.
 *
 * Names are ours throughout — `FSCEDITOR_*`, never `FSC_*` — because
 * fscopilot-bridge lives in the same Community folder and speaks on the same
 * buses. 03-link's rule.
 *
 * The wire format is defined in `src/shared/link.ts` and duplicated here. The
 * two must agree; there is no header they can share.
 *
 * The stage 2a spike this replaces — with its `units`, `snap`, `delta` and
 * `unitof` probes — is in git history at a3a856e. Its answers are in
 * docs/sim-vars/build/v1-log.md; the probes themselves were one-time questions.
 */

#include <MSFS/MSFS.h>
// DWORD, HANDLE, CALLBACK. SimConnect.h assumes them and does not include it
// itself; the legacy gauges header used to drag it in, and dropping that header
// took this with it.
#include <MSFS/MSFS_WindowsTypes.h>
#include <MSFS/MSFS_Vars.h>
// `execute_calculator_code`. This header was dropped in 2b when nothing needed
// it any more, and dropping it took `DWORD`/`HANDLE` with it — which is why
// `MSFS_WindowsTypes.h` above is included explicitly now rather than arriving
// through here by accident.
#include <MSFS/Legacy/gauges.h>
#include <SimConnect.h>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

namespace
{
constexpr auto k_version  = "0.7.0";
// 2 adds an argument to the command format and the `exec` command with it.
// 3 adds `rescan`, which is how the app asks whether the table grew without
// paying for a re-report of every value in it.
// 4 adds the watch set — `watch-reset` / `watch-add`, the `watched` mapping
// back, and watch-handle ids on the `values` stream.
// 5 adds resolution to the `watched` mapping — `<handle> <resolved> <name>`,
// re-sent whenever it moves — so an unresolved ref is visible as something
// other than silence.
// 6 makes that field three-state. `watch-add` answers before the tick has
// tried to resolve anything, so 5 had to call every fresh ref absent and
// correct itself a frame later; 2 means "not tried yet" and is the only
// honest thing to say at that moment.
//
// The app checks this and offers a reinstall when its own is newer, so an
// old module in the Community folder says so rather than silently ignoring
// every run — which is exactly what a 3 would do with a `watch-add`, leaving
// a `Z:` line blank with nothing saying why.
//
// `probe` (0.4.0) deliberately did not bump this. It is a maintainer
// diagnostic the app never sends, and the failure a bump protects against —
// the app waiting on a command an old module ignores — cannot happen to a
// command only `link:read` issues, by the person who just built the module.
constexpr int  k_protocol = 6;

enum : DWORD
{
    id_cmd = 0xE000,
    id_out = 0xE001
};

/** SimConnect's ceiling for one ClientData area, and so one message. */
constexpr int k_area_bytes = 8192;

/**
 * Reserved so a record can never be half-written into the tail of a message.
 *
 * A name can be long and a formatted double is bounded but not tiny; leaving
 * room for the largest plausible record means the packing loop only has to ask
 * "does this fit" rather than "does this fit, and if not can I split it".
 */
constexpr int k_record_headroom = 320;

/**
 * How often values are diffed and sent.
 *
 * 03-link says 10-20 Hz. `Update_StandAlone` runs per frame, which is far more
 * often than anything downstream can use — a person reading inlay hints, and a
 * correlation window measured in tens of milliseconds. Sending every frame
 * would multiply the wire traffic several times over for no information.
 */
constexpr double k_interval_seconds = 1.0 / 15.0;

/**
 * Below this, a change is noise rather than a change.
 *
 * Floating-point variables jitter in their last bits without anything having
 * happened, and every one of those would be a wire record and a false finding.
 * Small enough to keep a real switch flip, which is a whole integer step.
 */
constexpr double k_deadband = 1e-6;

HANDLE h_sim = 0;

/** Cached at enumeration. Ids are stable — proven across an aircraft change. */
std::vector<std::string> names;
std::vector<double>      last;

bool     streaming     = false;
bool     names_pending = false;
size_t   names_sent    = 0;
double   clock_seconds = 0;
double   next_send     = 0;
uint32_t seq           = 0;

/** Ids whose value moved since the last send, refilled every tick. */
std::vector<int> changed;

/**
 * Where watch handles start on the `values` wire.
 *
 * Watched refs share the stream with the enumerated table, so their ids must
 * never collide with its. The `L:` walk stops at 20,000; this is far past it,
 * and `src/shared/link.ts` carries the same number as WATCH_HANDLE_BASE.
 */
constexpr int k_watch_base = 1000000;

/**
 * One watched name — a ref the app asked about that is not in the `L:` table.
 *
 * The typed API's shape, learned from the 0.4.0 probe: resolve a name to an
 * id once, read by id each tick. `resolved` rather than a sentinel id because
 * the sentinels differ per family (-1 for Z:, 0 for E:), and a read that
 * fails un-resolves the ref — after an aircraft change a cached `Z:` id is
 * stale, the read errors, and re-resolving next tick is what makes the status
 * handler an accelerator rather than a correctness requirement.
 *
 * Protocol 6 carries three answers rather than two, and `unknown` is not a
 * nicety. `watch-add` answers with the mapping *before* the tick has tried to
 * resolve anything, so a two-state wire had to call every new ref absent and
 * correct itself a frame later — which the app could only read as "this
 * variable is not on this aircraft", briefly, about every variable it was
 * asked to watch. Not tried and not there are different facts and now have
 * different bytes.
 */
enum class Resolution : int
{
    absent  = 0,
    present = 1,
    unknown = 2,
};

struct Watched
{
    std::string name;   // As the app sent it — echoed in the `watched` mapping.
    size_t      bare;   // Offset of the name proper, past the prefix.
    char        kind;   // 'z', 'e', or '?' for a prefix this module cannot read.
    int         id       = -1;
    bool        resolved = false;
    /*
     * Whether the tick has *tried* to resolve this ref since it was added or
     * last invalidated. False makes the ref `unknown` on the wire however
     * `resolved` reads, which is what keeps a fresh watch set from announcing
     * thirteen absences it has not yet looked for.
     */
    bool        attempted = false;
    /*
     * The `Resolution` the app was last told, or -1 for a ref it has never
     * been told about.
     *
     * The app only needs to hear about a change. Comparing against what was
     * *reported* rather than against the previous tick keeps a ref that
     * resolves and then fails its read inside one tick from sending a message
     * per frame.
     */
    int         reported = -1;
    // `E:` reads are tried raw first; some may want an explicit unit. Flipped
    // once on the first failing raw read, never back.
    bool        number_unit = false;
    double      last        = std::nan("");

    /** The three-state answer, derived rather than stored twice. */
    Resolution state() const
    {
        if (!attempted) return Resolution::unknown;
        return resolved ? Resolution::present : Resolution::absent;
    }
};

std::vector<Watched> watched_refs;

/** Lazily resolved `number` unit for the E: fallback. */
FsUnitId u_number_cache    = FS_INVALID_UNIT;
bool     u_number_resolved = false;

FsUnitId number_unit_id()
{
    if (!u_number_resolved)
    {
        u_number_cache    = fsVarsGetUnitId("number");
        u_number_resolved = true;
    }
    return u_number_cache;
}

/** Case-insensitive prefix match, ASCII only — prefixes are ours. */
bool has_prefix_ci(const char* text, const char* prefix)
{
    for (; *prefix; ++text, ++prefix)
    {
        const char a = *text >= 'A' && *text <= 'Z' ? *text + 32 : *text;
        const char b = *prefix >= 'A' && *prefix <= 'Z' ? *prefix + 32 : *prefix;
        if (a != b) return false;
    }
    return true;
}

/**
 * Classifies one watched name by its written prefix.
 *
 * `L:1:` before `L:` matters in principle; in practice plain `L:` names never
 * arrive here — the app routes them to the enumerated stream — so an `L:`
 * that is not `L:1:` files as unreadable rather than as a second way to read
 * the table. Unknown prefixes are kept, unresolved forever: the mapping still
 * echoes them, and a handle that never reports is the app's cue to explain.
 */
void classify(Watched& ref)
{
    if (has_prefix_ci(ref.name.c_str(), "Z:")) { ref.kind = 'z'; ref.bare = 2; return; }
    if (has_prefix_ci(ref.name.c_str(), "L:1:")) { ref.kind = 'z'; ref.bare = 4; return; }
    if (has_prefix_ci(ref.name.c_str(), "E:")) { ref.kind = 'e'; ref.bare = 2; return; }
    ref.kind = '?';
    ref.bare = 0;
}

void send(const char* kind, uint32_t remaining, const std::string& payload);

/**
 * The complete handle→name mapping, chunked if it must be.
 *
 * The whole map every time rather than a delta, so the app can replace its
 * copy on receipt and no reset/add ordering can strand a stale handle. Sets
 * are a viewport at most; one message usually holds it all.
 *
 * Protocol 5: each line is `<handle> <resolved> <name>`. Resolution is as
 * much the point of the message as the mapping is — a ref that does not
 * resolve reports no values, and silence is indistinguishable from a switch
 * nobody has touched. Saying so is what lets the app tell an author "this
 * variable does not exist on this aircraft" instead of showing nothing.
 */
void send_watched()
{
    std::string payload;
    payload.reserve(k_area_bytes);

    char   line[512];
    size_t sent = 0;

    for (size_t n = 0; n < watched_refs.size(); ++n)
    {
        const int written = snprintf(line, sizeof(line), "%d %d %s\n",
                                     static_cast<int>(k_watch_base + n),
                                     static_cast<int>(watched_refs[n].state()),
                                     watched_refs[n].name.c_str());
        if (written < 0) continue;

        if (payload.size() + static_cast<size_t>(written) >
            static_cast<size_t>(k_area_bytes - k_record_headroom))
        {
            send("watched", static_cast<uint32_t>(watched_refs.size() - sent), payload);
            payload.clear();
        }

        payload += line;
        ++sent;
    }

    // Sent even when empty: an empty mapping is how the app learns a
    // `watch-reset` took effect.
    send("watched", 0, payload);

    // What the app has now been told, which the tick compares against.
    for (Watched& ref : watched_refs)
        ref.reported = static_cast<int>(ref.state());
}

void send(const char* kind, uint32_t remaining, const std::string& payload)
{
    if (h_sim == 0) return;

    char      message[k_area_bytes];
    const int header =
        snprintf(message, sizeof(message), "%s %u %u\n", kind, seq++, remaining);
    if (header < 0) return;

    const size_t room = sizeof(message) - static_cast<size_t>(header) - 1;
    const size_t take = payload.size() < room ? payload.size() : room;
    memcpy(message + header, payload.data(), take);
    memset(message + header + take, 0, sizeof(message) - header - take);

    (void)SimConnect_SetClientData(h_sim, id_out, id_out,
                                   SIMCONNECT_CLIENT_DATA_SET_FLAG_DEFAULT, 0,
                                   sizeof(message), message);
}

/*
 * Walks ids until the sim says there are no more.
 *
 * `fsVarsGetLVarName` returns an error code rather than a null, which is why
 * the modern API is used here and the deprecated one is not — and both were
 * measured stopping at the same id, so the two agree about where the table
 * ends. Bounded anyway: this runs inside a frame, and a walk that did not
 * terminate would hang the simulator rather than report a problem.
 */
void enumerate()
{
    constexpr FsLVarId k_ceiling = 20000;

    names.clear();
    last.clear();

    char name[256];
    for (FsLVarId id = 0; id < k_ceiling; ++id)
    {
        if (fsVarsGetLVarName(id, name, static_cast<int>(sizeof(name))) != FS_VAR_ERROR_NONE)
            break;
        if (name[0] == '\0') break;

        names.emplace_back(name);
        // NaN so the first read of every variable counts as a change, and the
        // app receives a complete picture rather than only what moved after it
        // happened to connect.
        last.push_back(std::nan(""));
    }

    names_pending = true;
    names_sent    = 0;
}

/*
 * Walks on from where the last walk stopped, and sends only what is new.
 *
 * This exists because `enumerate` answers a much bigger question than the one
 * the app keeps asking. An aircraft is still registering its variables when it
 * finishes loading, so the app re-walks on a backoff until two walks agree on
 * the count — and that question is about *names*. `enumerate` clears `last`,
 * which makes the next tick re-report all ~6,150 values, so asking "has the
 * table stopped growing?" cost a complete value flood every time. Four or five
 * of them per aircraft change, on the app's main thread.
 *
 * Here the existing ids keep their `last`, so nothing that has not moved says
 * anything. Only the newly-registered variables carry NaN, and only they report
 * on the next tick — which is exactly the news the app was re-walking for.
 *
 * Safe to start from `names.size()` because ids are dense and stable: the sim
 * hands them out in order and does not reshuffle them, proven across an
 * aircraft change. The full walk still runs on an aircraft change, which is
 * where a reshuffle would have to be caught.
 */
void rescan()
{
    constexpr FsLVarId k_ceiling = 20000;

    // A rescan mid-enumeration would rewind `names_sent` past chunks that have
    // not gone out yet, and those names would never be sent. Nothing is lost by
    // skipping: a walk is already in flight, and the app asks again.
    if (names_pending) return;

    const size_t before = names.size();

    char name[256];
    for (FsLVarId id = static_cast<FsLVarId>(before); id < k_ceiling; ++id)
    {
        if (fsVarsGetLVarName(id, name, static_cast<int>(sizeof(name))) != FS_VAR_ERROR_NONE)
            break;
        if (name[0] == '\0') break;

        names.emplace_back(name);
        last.push_back(std::nan(""));
    }

    // Nothing new. Silence is the answer: the app is comparing counts, and a
    // count it already has is not worth a message.
    if (names.size() == before) return;

    // From `before`, not from zero — `send_names_chunk` reads this as both the
    // next id and the next name, so the chunk that goes out carries only the
    // new ones and the app's `from` lands on the right id.
    names_pending = true;
    names_sent    = before;
}

/** One `names` message per call, so enumeration costs one frame per chunk. */
void send_names_chunk()
{
    std::string payload;
    payload.reserve(k_area_bytes);

    const size_t before = names_sent;

    char line[512];
    while (names_sent < names.size())
    {
        const int written = snprintf(line, sizeof(line), "%d %s\n",
                                     static_cast<int>(names_sent),
                                     names[names_sent].c_str());
        if (written < 0) break;

        if (payload.size() + static_cast<size_t>(written) >
            static_cast<size_t>(k_area_bytes - k_record_headroom))
            break;

        payload += line;
        ++names_sent;
    }

    // No progress means one name did not fit even in an empty message, which
    // would otherwise spin forever sending nothing.
    if (names_sent == before)
    {
        names_pending = false;
        return;
    }

    // Chunks still to come, estimated from what this one carried, so a reader
    // can tell a finished enumeration from one the stream cut short.
    const size_t left      = names.size() - names_sent;
    const size_t per_chunk = names_sent - before;
    send("names", static_cast<uint32_t>((left + per_chunk - 1) / per_chunk), payload);

    if (names_sent >= names.size()) names_pending = false;
}

/**
 * Reads every variable by cached id and sends the ones that moved.
 *
 * Reading by id rather than through `execute_calculator_code` is the whole
 * reason for a module of our own — 03-link is explicit that an expression-based
 * watcher is right for dozens of variables and hopeless for thousands.
 *
 * Values are read with `FS_INVALID_UNIT`, the unconverted native read. The app
 * converts per entry when it knows what unit a profile asked for; the module
 * has no idea what any given profile wants and would be guessing.
 */
void send_values()
{
    changed.clear();

    const size_t count = names.size();
    for (size_t id = 0; id < count; ++id)
    {
        double value = 0;
        if (fsVarsLVarGet(static_cast<FsLVarId>(id), FS_INVALID_UNIT, &value) !=
            FS_VAR_ERROR_NONE)
            continue;

        const double previous = last[id];
        // Both comparisons are false when `previous` is NaN, which is what makes
        // the first tick after enumeration report every variable.
        if (previous == value) continue;
        if (previous - value < k_deadband && value - previous < k_deadband) continue;

        last[id] = value;
        changed.push_back(static_cast<int>(id));
    }

    /*
     * The watch set, on the same tick with the same deadband.
     *
     * Unresolved refs retry their resolve here — watch sets are a viewport at
     * most, so a per-tick retry costs a handful of failed lookups while an
     * aircraft loads and nothing after. A read that errors un-resolves: a
     * cached `Z:` id is stale after an aircraft change, and the error is the
     * first anyone hears of it when the status handler did not fire.
     */
    std::vector<std::pair<int, double>> watch_changed;

    for (size_t n = 0; n < watched_refs.size(); ++n)
    {
        Watched& ref = watched_refs[n];
        if (ref.kind == '?') continue;

        if (!ref.resolved)
        {
            const char* bare = ref.name.c_str() + ref.bare;
            if (ref.kind == 'z')
            {
                ref.id = fsVarsGetZVarId(bare, FS_OBJECT_ID_USER_AIRCRAFT);
                ref.resolved = ref.id >= 0;
            }
            else
            {
                // FS_VAR_EVAR_NONE is 0 — the E: family's "no such variable".
                ref.id       = fsVarsGetEVarId(bare);
                ref.resolved = ref.id != FS_VAR_EVAR_NONE;
            }
            // The lookup ran, so whatever it says is a finding rather than an
            // absence of one. This is the line that turns `unknown` into an
            // answer.
            ref.attempted = true;
            if (!ref.resolved) continue;
        }

        double     value = 0;
        FsVarError error = FS_VAR_ERROR_NONE;

        if (ref.kind == 'z')
        {
            error = fsVarsZVarGet(static_cast<FsZVarId>(ref.id), FS_INVALID_UNIT,
                                  &value, FS_OBJECT_ID_USER_AIRCRAFT);
        }
        else
        {
            const FsUnitId unit = ref.number_unit ? number_unit_id() : FS_INVALID_UNIT;
            error               = fsVarsEVarGet(static_cast<FsEVarId>(ref.id), unit, &value);
            // The probe read E: through an explicit unit; whether the raw read
            // works too was never asked. One retry through `number`, decided
            // per ref on the first failure and remembered.
            if (error != FS_VAR_ERROR_NONE && !ref.number_unit)
            {
                ref.number_unit = true;
                error = fsVarsEVarGet(static_cast<FsEVarId>(ref.id), number_unit_id(), &value);
            }
        }

        if (error != FS_VAR_ERROR_NONE)
        {
            // Unknown rather than absent: a read that errors means the id is
            // stale, not that the variable is gone. The next tick re-resolves
            // and produces a real verdict one frame later.
            ref.resolved  = false;
            ref.attempted = false;
            ref.last      = std::nan("");
            continue;
        }

        const double previous = ref.last;
        if (previous == value) continue;
        if (previous - value < k_deadband && value - previous < k_deadband) continue;

        ref.last = value;
        watch_changed.emplace_back(static_cast<int>(k_watch_base + n), value);
    }

    /*
     * Resolution moved, so the mapping is stale. This is the whole reason an
     * unresolved ref is visible at all: it reports no values by definition,
     * so without a message here the app would see only silence — and silence
     * is what an untouched switch looks like too.
     */
    for (const Watched& ref : watched_refs)
    {
        if (static_cast<int>(ref.state()) == ref.reported) continue;
        send_watched();
        break;
    }

    const size_t total = changed.size() + watch_changed.size();
    if (total == 0) return;

    std::string payload;
    payload.reserve(k_area_bytes);

    char   line[128];
    size_t sent = 0;

    const auto append = [&](int id, double value) {
        const int written = snprintf(line, sizeof(line), "%d %.9g\n", id, value);
        if (written < 0) return;

        if (payload.size() + static_cast<size_t>(written) >
            static_cast<size_t>(k_area_bytes - k_record_headroom))
        {
            // One area holds one value, so a burst larger than a message has to
            // be split — and each part says how many records still follow.
            send("values", static_cast<uint32_t>(total - sent), payload);
            payload.clear();
        }

        payload += line;
        ++sent;
    };

    for (const int id : changed) append(id, last[id]);
    for (const auto& entry : watch_changed) append(entry.first, entry.second);

    if (!payload.empty()) send("values", 0, payload);
}

/** Set by `probe`, so the handler below narrates its firings to `link:read`. */
bool probe_watching = false;

/** How registering the handler went at init, reported by `probe`. */
FsVarError status_register_error = FS_VAR_ERROR_FAIL;

/**
 * Fires when the sim invalidates variables — an object destroyed takes its
 * I/O/Z vars with it, a flight restart resets them. Measured by the 0.4.0
 * probe on an aircraft change: a burst of ZVAR|OVAR|IVAR removes per object,
 * then an LVAR reset.
 *
 * Two duties, both accelerations rather than correctness:
 *
 * - A ZVAR flag un-resolves the watched `Z:` refs, so the next tick
 *   re-resolves against the new aircraft instead of erroring once first.
 * - An LVAR reset runs `rescan()` — a push answering the very question the
 *   app's settle loop polls for. The loop stays, as the fallback for a sim
 *   that never fires this; the push just makes the common case immediate.
 */
void on_vars_status(FsVarTypeFlags flags, FsVarUpdateOp op, FsObjectId object, void*)
{
    if (flags & FS_VAR_TYPE_ZVAR)
    {
        for (Watched& ref : watched_refs)
        {
            if (ref.kind != 'z') continue;
            ref.resolved  = false;
            // Unknown, not absent: this aircraft has not been asked yet, and
            // announcing every watched ref missing during a swap is the flash
            // protocol 6 exists to remove.
            ref.attempted = false;
            // NaN so the re-resolved value reports even if numerically equal —
            // it belongs to a different aircraft now.
            ref.last = std::nan("");
        }
    }

    if ((flags & FS_VAR_TYPE_LVAR) && op == FS_VAR_UPDATE_OP_RESET) rescan();

    if (probe_watching)
    {
        char line[128];
        (void)snprintf(line, sizeof(line), "status fired: flags=%u op=%u object=%u\n",
                       flags, static_cast<unsigned>(op), object);
        send("probe", 0, line);
    }
}

/*
 * The typed-API smoke test, and a one-time question.
 *
 * The variable model generalises this module's enumerate → cache id → read
 * loop over the other namespaces in `MSFS_Vars.h`. The header is on disk and
 * the `L:` third is proven above; everything else in that plan is assumption.
 * This answers the assumptions in one build: ids resolve, reads read, units
 * convert, a missing name fails rather than lies, and the status handler
 * fires. One `probe` message, human-readable lines, shown by `link:read` and
 * ignored by the app.
 *
 * There is a sharper failure mode this cannot report and does not need to:
 * if the sim's runtime lacks any of these imports, the module never loads and
 * the hello never appears — which is the same question answered louder.
 */
void probe()
{
    std::string out;
    char        line[320];
    double      value = 0;
    FsVarError  error = FS_VAR_ERROR_NONE;

    const FsUnitId u_number = fsVarsGetUnitId("number");
    const FsUnitId u_second = fsVarsGetUnitId("seconds");
    const FsUnitId u_feet   = fsVarsGetUnitId("feet");
    const FsUnitId u_meters = fsVarsGetUnitId("meters");
    (void)snprintf(line, sizeof(line), "units: number=%d seconds=%d feet=%d meters=%d\n",
                   u_number, u_second, u_feet, u_meters);
    out += line;

    // E: — zulu time is never 0 in a flight, so a real read is distinguishable
    // from a stub at a glance.
    const FsEVarId e_id = fsVarsGetEVarId("ZULU TIME");
    value = 0;
    error = fsVarsEVarGet(e_id, u_second, &value);
    (void)snprintf(line, sizeof(line), "E:ZULU TIME: id=%d err=%u value=%.9g\n", e_id,
                   error, value);
    out += line;

    // A: — the same variable in two units answers whether `fsVarsGetUnitId`
    // is wired to conversion: ~3.28 apart if it is.
    const FsAVarId  a_id = fsVarsGetAVarId("PLANE ALTITUDE");
    FsVarParamArray no_params;
    double          feet = 0, meters = 0;
    const FsVarError e_ft =
        fsVarsAVarGet(a_id, u_feet, no_params, &feet, FS_OBJECT_ID_USER_AIRCRAFT);
    const FsVarError e_m =
        fsVarsAVarGet(a_id, u_meters, no_params, &meters, FS_OBJECT_ID_USER_AIRCRAFT);
    (void)snprintf(line, sizeof(line),
                   "A:PLANE ALTITUDE: id=%d feet=%.9g err=%u meters=%.9g err=%u\n", a_id,
                   feet, e_ft, meters, e_m);
    out += line;

    // Missing names, one per id-space. What comes back decides the empty
    // states: a resolve that fails is "not in this aircraft", a resolve that
    // succeeds and reads 0 cannot be told apart from a real zero.
    (void)snprintf(line, sizeof(line), "A: missing: id=%d\n",
                   fsVarsGetAVarId("FSCEDITOR PROBE MISSING"));
    out += line;
    (void)snprintf(line, sizeof(line), "L: missing: id=%d\n",
                   fsVarsGetLVarId("FSCEDITOR_PROBE_MISSING"));
    out += line;
    (void)snprintf(line, sizeof(line), "Z: missing: id=%d\n",
                   fsVarsGetZVarId("FSCEDITOR_PROBE_MISSING", FS_OBJECT_ID_USER_AIRCRAFT));
    out += line;

    // Z: — Asobo's audio panel registers this on most stock aircraft, and it
    // is the one Z: the profile corpus actually reads.
    const FsZVarId z_id =
        fsVarsGetZVarId("AUDIO_Knob_Selector_1", FS_OBJECT_ID_USER_AIRCRAFT);
    value = 0;
    error = fsVarsZVarGet(z_id, FS_INVALID_UNIT, &value, FS_OBJECT_ID_USER_AIRCRAFT);
    (void)snprintf(line, sizeof(line), "Z:AUDIO_Knob_Selector_1: id=%d err=%u value=%.9g\n",
                   z_id, error, value);
    out += line;

    // Z: roundtrip — register, set both ways, read back. 42 because a 0 could
    // be the sim's own default and prove nothing. Set is tried raw and with a
    // unit because reads take FS_INVALID_UNIT and nothing says writes do.
    const FsZVarId z_new = fsVarsRegisterZVar("FSCEDITOR_PROBE_Z", FS_OBJECT_ID_USER_AIRCRAFT);
    const FsVarError e_raw =
        fsVarsZVarSet(z_new, FS_INVALID_UNIT, 42, FS_OBJECT_ID_USER_AIRCRAFT);
    const FsVarError e_num = fsVarsZVarSet(z_new, u_number, 42, FS_OBJECT_ID_USER_AIRCRAFT);
    value = 0;
    error = fsVarsZVarGet(z_new, FS_INVALID_UNIT, &value, FS_OBJECT_ID_USER_AIRCRAFT);
    (void)snprintf(line, sizeof(line),
                   "Z: roundtrip: reg=%d set(raw)=%u set(number)=%u get=%u value=%.9g want 42\n",
                   z_new, e_raw, e_num, error, value);
    out += line;

    // I: and O: want a component path only a loaded aircraft can supply, so
    // this asks with an empty one and reports what that costs. A read against
    // a real path is the follow-up, once these error codes are known.
    (void)snprintf(line, sizeof(line), "I: empty path: get=%d reg=%d\n",
                   fsVarsGetIVarId("FSCEDITOR_PROBE_I", "", FS_OBJECT_ID_USER_AIRCRAFT),
                   fsVarsRegisterIVar("FSCEDITOR_PROBE_I", "", FS_OBJECT_ID_USER_AIRCRAFT));
    out += line;
    (void)snprintf(line, sizeof(line), "O: empty path: get=%d reg=%d\n",
                   fsVarsGetOVarId("FSCEDITOR_PROBE_O", "", FS_OBJECT_ID_USER_AIRCRAFT),
                   fsVarsRegisterOVar("FSCEDITOR_PROBE_O", "", FS_OBJECT_ID_USER_AIRCRAFT));
    out += line;

    // B: is served client-side and nothing in the plan needs this call — but
    // the answer is one call away, and "the fallback exists" is worth a line.
    const FsBVarId b_id =
        fsVarsGetBVarId("LANDING_GEAR_PARKINGBRAKE", false, FS_OBJECT_ID_USER_AIRCRAFT);
    value = 0;
    error = fsVarsBVarGet(b_id, FS_INVALID_UNIT, &value, FS_OBJECT_ID_USER_AIRCRAFT);
    (void)snprintf(line, sizeof(line),
                   "B:LANDING_GEAR_PARKINGBRAKE: id=%d err=%u value=%.9g\n", b_id, error,
                   value);
    out += line;

    // Registered at module_init since 0.5.0 — the watch set depends on it for
    // prompt invalidation. Probe reports how that went, arms the narration,
    // and retries a failed registration while it is here.
    if (status_register_error != FS_VAR_ERROR_NONE)
        status_register_error =
            fsVarsRegisterVarsStatusUpdateHandler(on_vars_status, nullptr, true);
    probe_watching = true;
    (void)snprintf(line, sizeof(line),
                   "status handler: register err=%u — change aircraft to see it fire\n",
                   status_register_error);
    out += line;

    send("probe", 0, out);
}

void CALLBACK dispatch(SIMCONNECT_RECV* data, DWORD, void*)
{
    if (data->dwID != SIMCONNECT_RECV_ID_CLIENT_DATA) return;

    const auto* recv = reinterpret_cast<SIMCONNECT_RECV_CLIENT_DATA*>(data);
    if (recv->dwRequestID != id_cmd) return;

    const char* command = reinterpret_cast<const char*>(&recv->dwData);

    if (strncmp(command, "start", 5) == 0)
    {
        if (names.empty())
        {
            enumerate();
        }
        else
        {
            /*
             * Forget what every variable last read, so the next tick reports
             * all of them.
             *
             * `start` means "begin streaming to me", and a client that has just
             * said it has no idea what anything currently is. Without this it
             * receives only what happens to move *after* it connected — which,
             * for a cockpit full of switches nobody is touching, is nothing.
             *
             * It matters because the module outlives the app. Restart the
             * editor while MSFS keeps running and the table is already walked,
             * so `enumerate()` is skipped and `last` still holds live values:
             * names arrive, no values follow, and the editor shows blank lines
             * until the user flips something. Reported exactly that way.
             *
             * `enumerate()` would also fix it — it clears `last` — but it walks
             * up to 20,000 ids to rediscover names that have not changed. This
             * is the same effect for the cost of a memset.
             */
            for (double& previous : last) previous = std::nan("");
        }

        /*
         * Always re-send the names, even when the table is already walked.
         *
         * There is one output area and every client reads all of it, so a
         * second client — the app alongside `link:read`, say — arrives to find
         * the enumeration long since sent and nothing but ids afterwards, which
         * it cannot decode. Found exactly that way: a reader connected after
         * the app and logged values with no names to resolve them against.
         *
         * Re-sending costs the first client nothing; its own inserts are
         * idempotent, and names by id do not change.
         */
        names_pending = true;
        names_sent    = 0;
        streaming     = true;

        char hello[256];
        (void)snprintf(hello, sizeof(hello), "%s %d %d\n", k_version, k_protocol,
                       static_cast<int>(names.size()));
        send("hello", 0, hello);
        return;
    }

    if (strncmp(command, "stop", 4) == 0)
    {
        streaming = false;
        return;
    }

    if (strncmp(command, "exec ", 5) == 0)
    {
        /*
         * `exec <token> <code>` — run calculator code, and say what happened.
         *
         * Bounded copy, unlike the commands above: those compare a fixed nine
         * bytes and this reads to the end of the area, which a client other
         * than ours is under no obligation to have terminated. 8 KB of stack
         * for the duration of one command, and commands are a click apart.
         */
        char text[k_area_bytes];
        memcpy(text, command, sizeof(text));
        text[sizeof(text) - 1] = '\0';

        char*               end   = nullptr;
        const unsigned long token = strtoul(text + 5, &end, 10);
        // No token means nothing to answer to — every reply is broadcast to
        // every client, so an uncorrelated one is worse than silence.
        if (end == nullptr || end == text + 5 || *end != ' ') return;

        const char* code = end + 1;
        if (*code == '\0') return;

        /*
         * The sim's own calculator, which is the whole point: FS Copilot runs
         * these expressions through the same function, so code that works here
         * works there. A `false` is the calculator rejecting the code, and it
         * is reported rather than swallowed — a typo'd variable name is the
         * most common thing a person will do with this.
         */
        FLOAT64    value = 0;
        const bool ok    = execute_calculator_code(code, &value, nullptr, nullptr);

        char reply[128];
        (void)snprintf(reply, sizeof(reply), "%lu %s %.9g\n", token, ok ? "ok" : "err",
                       value);
        send("exec", 0, reply);
        return;
    }

    if (strncmp(command, "watch-reset", 11) == 0)
    {
        watched_refs.clear();
        // The empty mapping, so the app replaces its copy rather than holding
        // handles for refs that no longer exist.
        send_watched();
        return;
    }

    if (strncmp(command, "watch-add", 9) == 0)
    {
        /*
         * `watch-add\n<name>\n<name>…` — the first command to span lines,
         * because a variable name can contain spaces. Bounded copy like
         * `exec`, and for the same reason: this reads to the end of the area.
         */
        char text[k_area_bytes];
        memcpy(text, command, sizeof(text));
        text[sizeof(text) - 1] = '\0';

        const char* cursor = strchr(text, '\n');
        while (cursor != nullptr)
        {
            const char* start = cursor + 1;
            const char* end   = strchr(start, '\n');
            const size_t length = end ? static_cast<size_t>(end - start) : strlen(start);
            cursor = end;

            if (length == 0) continue;

            Watched ref;
            ref.name.assign(start, length);
            classify(ref);
            watched_refs.push_back(std::move(ref));
        }

        // The complete mapping after every add: the app replaces on receipt,
        // so ordering against a reset cannot strand a stale handle.
        send_watched();
        return;
    }

    if (strncmp(command, "probe", 5) == 0)
    {
        probe();
        return;
    }

    // Before `enumerate`, because `strncmp` on nine bytes would not tell them
    // apart if this were spelled with the same prefix. It is not — but the
    // ordering is one less thing to be careful about later.
    if (strncmp(command, "rescan", 6) == 0)
    {
        // "Did anything new register?" — the question the app's settle loop is
        // actually asking, answered without disturbing a single value.
        rescan();
        return;
    }

    if (strncmp(command, "enumerate", 9) == 0)
    {
        // Re-walk from scratch. The table grows while a session runs — 784 names
        // appeared between two snapshots of one aircraft — so a long session
        // needs a way to catch up without a restart.
        //
        // Still the right answer on an aircraft change, where the values left
        // behind belong to an aeroplane that is gone: clearing `last` is what
        // replaces them rather than leaving them to look live. `rescan` is for
        // the repeats that follow.
        enumerate();
        return;
    }
}
} // namespace

extern "C" MSFS_CALLBACK void module_init(void)
{
    if (FAILED(SimConnect_Open(&h_sim, "fsc-editor-link", nullptr, 0, 0, 0))) return;

    (void)SimConnect_MapClientDataNameToID(h_sim, "FSCEDITOR_LINK_CMD", id_cmd);
    (void)SimConnect_CreateClientData(h_sim, id_cmd, k_area_bytes, 0);
    (void)SimConnect_AddToClientDataDefinition(h_sim, id_cmd, 0, k_area_bytes, 0, 0);
    (void)SimConnect_RequestClientData(h_sim, id_cmd, id_cmd, id_cmd,
                                       SIMCONNECT_CLIENT_DATA_PERIOD_ON_SET, 0, 0, 0, 0);

    (void)SimConnect_MapClientDataNameToID(h_sim, "FSCEDITOR_LINK_OUT", id_out);
    (void)SimConnect_CreateClientData(h_sim, id_out, k_area_bytes, 0);
    (void)SimConnect_AddToClientDataDefinition(h_sim, id_out, 0, k_area_bytes, 0, 0);

    // The invalidation push behind the watch set — see `on_vars_status`. A
    // failure here is not fatal: reads that error un-resolve themselves, and
    // `probe` reports and retries the registration.
    status_register_error = fsVarsRegisterVarsStatusUpdateHandler(on_vars_status, nullptr, true);

    // A hello left sitting in the area, so a client connecting later can tell
    // "no module" from "module running but silent" with a one-shot read. That
    // distinction cost two sim restarts to learn.
    char hello[256];
    (void)snprintf(hello, sizeof(hello), "%s %d 0\n", k_version, k_protocol);
    send("hello", 0, hello);

    (void)SimConnect_CallDispatch(h_sim, dispatch, nullptr);
}

extern "C" MSFS_CALLBACK void module_deinit(void)
{
    if (h_sim != 0) (void)SimConnect_Close(h_sim);
    h_sim = 0;
}

/*
 * MSFS 2024's per-frame hook.
 *
 * Everything expensive is rate-limited off this rather than run per frame: the
 * diff at 15 Hz, and enumeration one chunk at a time. A module that stalls here
 * stalls the simulator, which is a far worse failure than a late value.
 */
extern "C" MSFS_CALLBACK void Update_StandAlone(float delta_seconds)
{
    if (h_sim == 0) return;

    (void)SimConnect_CallDispatch(h_sim, dispatch, nullptr);
    if (!streaming) return;

    clock_seconds += delta_seconds;

    // Names first and alone: a fresh client cannot read a value message until it
    // knows what the ids mean.
    if (names_pending)
    {
        send_names_chunk();
        return;
    }

    if (clock_seconds < next_send) return;
    next_send = clock_seconds + k_interval_seconds;

    send_values();
}
