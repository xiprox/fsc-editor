# Synaptic / iniBuilds A220-300 — reverse-engineering reference

Working notes for authoring an FS Copilot profile. Written for my own re-reading, not for
publication. Everything here was derived by reading the installed package; claims marked
**[unverified]** were inferred from code and have not been confirmed in the sim.

## Provenance

- Package: `synaptic-aircraft-a220`, `package_version 1.0.8`, `creator "Synaptic / iniBuilds"`,
  `builder "Microsoft Flight Simulator 2024"`, `minimum_game_version 1.8.14`.
  `release_notes.OlderHistory` says "VERSION 1.0.7 RELEASED AUGUST 27, 2026".
- Install root on this machine:
  `C:\Users\<user>\AppData\Roaming\Microsoft Flight Simulator 2024\Packages\Community\synaptic-aircraft-a220`
  (MSFS 2024 only. `UserCfg.opt` `InstalledPackagesPath` points at `...\Microsoft Flight Simulator 2024\Packages`.)
  Liveries ship as separate `synaptic-a220-livery-*` packages.
- Read date: 2026-09-04. Re-verify version before trusting name lists after an update.
- To regenerate the raw material: `strings -n 4 systems.wasm > wasm-strings.txt` — nearly
  everything below about the WASM came out of that plus the model-behaviour XML.

## Package layout

```
Config/Default/{checklists.json (768 KB, MSFS 2024 ECL), defaults.json ({"tpmu":true,"defaults":null})}
Navigraph/BundledData/                      ~151 MB bundled navdata
html_ui/Pages/VCockpit/Instruments/
  a22x/{CTP,DisplayUnits,FCP,ISI,MKP,Sentry}/instrument.js    1.7-3.7 MB each, MSFS Avionics Framework (JS)
  efb-a220/efb-a220.js                                        iniBuilds EFB, heavily obfuscated (string-array)
SimObjects/Airplanes/Synaptic_A220/
  common/config/{aircraft,systems,flight_model,engines,cameras,cockpit,gameplay,ai}.cfg
  common/checklist/A220_Checklist.xml       legacy KB_Checklists format, superseded
  common/panel/panel.cfg                    EMPTY - not the one that matters
  attachments/inibuilds/
    Part_Interior_A223_Cockpit/panel/{panel.cfg, systems.wasm (6.8 MB)}   <-- the real panel.cfg
    Asset_A220_Common/Synaptic/A220/**.xml                                <-- model behaviours
  presets/inibuilds/A220-300{,_NoCabin}/
```

Only one FLTSIM entry: `Title = "Synaptic Simulations A220-300"`, `atc_model BCS3`,
`icao_type_designator BCS3`, `icao_model "A220-300"`, `atc_id "C-FFCO"`. There is a `_NoCabin`
model preset but it is a model variant, not a separately selectable aircraft.

`panel.cfg` (the real one) — VCockpit assignments:

| VCockpit | Texture | Gauge |
| --- | --- | --- |
| 01 | NO_TEXTURE | `WasmInstrument.html?wasm_module=systems.wasm&wasm_gauge=a220` |
| 02 | `$A22X_DU` | `a22x/DisplayUnits` — 7410x1110 px, **all five DUs on one texture** |
| 03 / 04 | `MKP_1` / `MKP_2` | `a22x/MKP?side=left|right` |
| 05 / 06 | `CTP_1` / `CTP_2` | `a22x/CTP?side=left|right` |
| 07 | `$ISIS_DISPLAY` | `a22x/ISI` — 250x250 px |
| 08-11 | `FCU_SPEED`/`FCU_HDG`/`FCU_ALT`/`FCU_VS` | `a22x/FCP?type=speed|hdg|alt|vs` |
| 12 / 13 | `$EFB_1` / `$EFB_2` | `efb-a220?Index=1|2` |
| 14 | NO_TEXTURE | `a22x/Sentry` — headless 0x0 gauge |

## Architecture — the thing to remember

Three cooperating layers:

1. **`systems.wasm`** — the entire aircraft systems model, written in **Rust**. The binary
   still carries `src/systems/src/**.rs` panic paths, so the module map is legible (see
   "Rust module map"). It owns state; it reads a small set of sim vars, writes a small set of
   LVARs, and intercepts a curated list of key events.
2. **JS instruments** (MSFS Avionics Framework / Working Title style) — six bundles that
   *render* and *do not own state*.
3. **CommBus** — the transport between 1 and 2. The WASM imports `fsCommBusCall` /
   `fsCommBusRegister`. Aircraft state is serialised to JSON and published on named channels.
   **CommBus is in-sim only; SimConnect cannot see it.**

The consequence that dominates profile authoring: **most of the aircraft's live state is not
on the SimConnect surface at all.** LVARs exist for *inputs* (switch positions the model
behaviours write) and for *annunciator lamps* and a handful of scalars. Displayed values —
speeds, altitudes, QNH, engine parameters, hydraulic pressures, CAS messages — live on the
CommBus.

## THE ALTIMETER PROBLEM

**Summary.** Baro on this aircraft cannot be synced closed-loop. Altimetry lives entirely
inside the Rust `systems.wasm`, which never touches `A:KOHLSMAN SETTING MB/HG` — the string
does not occur in the binary — and publishes the selected QNH only as `qnh_hpa` / `qnh_inhg`
on the `A22X.{L,R} PFD Data` CommBus channels, which SimConnect cannot see. The only writable
controls are `L:A22X {L,R,ISI} Altimeter Set`, which takes a **signed detent delta** rather
than an absolute pressure, and the momentary `... Altimeter STD`. So there is no readback to
converge against and no way to address a value directly. N writes move the drum N detents;
where it *lands* depends on where it started, which is unknowable — the same command sequence
puts two differently-initialised aircraft on two different QNHs. The captain's, F/O's and ISI
altimeters each hold their own setting, so pushing an identical delta to all three preserves
any pre-existing offset rather than removing it. `L:A22X {L,R} Altimeter HPA` (hPa vs inHg) is
the one baro fact that is readable. Separately, whether N writes even produce N detents is
unverified: if the WASM consumes-and-resets the variable each tick, the SimConnect write rate
races the tick rate and writes may be dropped. Closing the loop properly requires an in-sim
WASM module to subscribe to the CommBus and re-publish `qnh_hpa` as an LVAR (see "Workaround"
below). The one route to an absolute datum *without* that bridge would be homing against the
knob's limit — see the open questions.

Note the vocabulary: the failure is **open-loop**, not non-deterministic. The mechanism is
perfectly repeatable; what is missing is feedback.

**`A:KOHLSMAN SETTING MB:N` and `A:KOHLSMAN SETTING HG:N` are not connected to this aircraft.**

Evidence:

- The string `KOHLSMAN` does not occur anywhere in `systems.wasm`. Neither does `KOHLSMAN_SET`
  nor a `BAROMETRIC` key event. The MSFS gauge API requires the literal name to resolve a sim
  var or key event, so their absence is conclusive: the WASM never reads or writes it.
- The only pressure-related sim vars the WASM touches are `AMBIENT PRESSURE`,
  `SEA LEVEL PRESSURE`, `PRESSURE ALTITUDE`, `DYNAMIC PRESSURE`, `AMBIENT TEMPERATURE`.
  It derives baro-corrected altitude itself.
- `KOHLSMAN SETTING MB:#index#` *does* appear in all six JS bundles — but only inside the
  stock Avionics SDK `AdcPublisher` sim-var table (alongside
  `altimeter_baro_preselect_* -> L:XMLVAR_Baro#index#_SavedPressure` and
  `altimeter_baro_is_std -> L:XMLVAR_Baro#index#_ForcedToSTD`). Nothing in the A220 code
  subscribes to those topics. Bundled dead code.

So: `KOHLSMAN SETTING MB` reports the sim's vestigial altimeter. It does not follow the CTP
baro knob, and `A:INDICATED ALTITUDE` will disagree with the PFD whenever the two differ.

### Where the QNH actually lives

Inside the WASM, published on the PFD CommBus channels (`A22X.L PFD Data`, `A22X.R PFD Data`)
as JSON fields:

```
same_source  altitude_m  qnh_hpa  qnh_inhg  qnh_misconfig_set  qnh_misconfig_std
tat  sat  airspeed_trend  v_min_trim  v_aoa_soft  v_aoa_hard  v_ld_max
```

`qnh_misconfig_set` / `qnh_misconfig_std` are the transition-altitude misconfiguration flags.

**There is no LVAR and no sim var carrying the selected QNH.** Reading it over SimConnect is
impossible as shipped.

### Workaround worth considering

A WASM module in the same sim *can* subscribe to the CommBus. `fsc-editor-link`
(`link/src/module.cpp` in this repo, shipped as `Community/fsc-editor-link`) is already a
standalone in-sim WASM module — today it only enumerates and streams vars, no CommBus. Adding
`fsCommBusRegister("A22X.L PFD Data", ...)`, parsing `qnh_hpa` / `qnh_inhg` /
`qnh_misconfig_*`, and writing them into synthetic LVARs (e.g. `L:FSCE A22X L QNH HPA`) would
make the value readable by anything on SimConnect. The same trick unlocks every other CommBus
channel listed below. This is the only clean route to a closed-loop "set QNH to X" behaviour.

### Baro controls that *are* reachable

Source: `Asset_A220_Common/Synaptic/A220/Cockpit/Glareshield/CTP.xml` and `.../ISI.xml`.
CTP `#INDEX#` 1 -> `#SIDE#` `L` (captain), 2 -> `R` (F/O); `panel.cfg` confirms CTP_1 = `side=left`.

| LVAR | Template | Direction | Semantics |
| --- | --- | --- | --- |
| `L:A22X L Altimeter Set`, `L:A22X R Altimeter Set` | `A220_KnobContinuous`, `<VAR>` only | write | Knob delta. `SET_STATE_EXTERNAL` is `p0 (>VAR)`: writes the signed detent count. `+n` clockwise, `-n` counter-clockwise. NOT an absolute pressure. |
| `L:A22X L Altimeter STD`, `L:A22X R Altimeter STD` | `A220_KnobContinuous` `BTN_VAR`, `BTN_TOGGLE` unset | write | Momentary. Template does `1 (>VAR)`. Corresponds to `CtpAction::SetStd`. |
| `L:A22X L Altimeter HPA`, `L:A22X R Altimeter HPA` | `A220_KnobRing` -> `A220_Button` `IS_LATCHED` | **read + write** | Latched bool. `SET_STATE_EXTERNAL` is `(VAR,Bool) ! (>VAR)`, `GET_STATE_EXTERNAL` is `(VAR,Bool)`. `1` = hPa, `0` = inHg **[unverified: polarity]**. The one baro fact readable over SimConnect. |
| `L:A22X ISI Altimeter Set` | as above | write | Standby instrument, delta. |
| `L:A22X ISI Altimeter STD` | as above | write | Standby instrument, momentary. |
| `L:INI_BARO_SYNC_OPTION` | EFB setting | read + write | Cross-syncs baro between L / R / ISI. Value set **[unverified]** — EFB bundle is string-array obfuscated. With sync on, driving one side should be enough. |

WASM-side enums seen in the binary:
`Altimeter::{InHg, Hpa}` and
`CtpAction::{SetConfig, IncMinimums, DecMinimums, IncLdgElev, DecLdgElev, IncCourse, DecCourse, NextNavSource, BaroSet, SetHpa, SetStd, SetAuto, ToggleCrosstune}`.
Note `SetAuto` — an auto-baro action with no obvious LVAR; likely only reachable via the CTP
CommBus command channel.

### Open questions on baro — settle empirically before shipping

1. Is `... Altimeter Set` **consume-and-reset** (WASM zeroes it each tick, so repeated writes
   of `1` step repeatedly) or **edge-triggered on change** (needs `1,0,1,0,...` or a rising
   ramp)? Consume-and-reset is the Rust-framework convention, so probably the former, but
   this decides the shape of any "set QNH" macro.
2. Detent size per unit mode — presumably 1 hPa and 0.01 inHg. Unconfirmed.
3. Does `... Altimeter STD` toggle or set? The model writes only `1`; the WASM decides.
4. Polarity of `... Altimeter HPA`.
5. Whether `L:INI_BARO_SYNC_OPTION` makes the ISI follow too. Even with the absolute problem
   unsolved, turning cross-sync on collapses three unknown settings into one unknown setting,
   so error stops compounding across instruments. Worth defaulting on in a profile.
6. **Does the setting clamp or wrap at its limits?** If it clamps, a large negative delta
   (say `-600`) homes the drum to a known floor, and counting up from there addresses any
   absolute QNH open-loop. This is the only route to a datum that does not need the CommBus
   bridge. Needs: clamp-not-wrap confirmed, the exact limit value (typ. 745 hPa / 22.00 inHg
   **[unverified]**), and confirmation that a long burst of writes is not partially dropped
   (see item 1 — the two interact).

## LVAR catalogue

### How to read the semantics

Derived from `Asset_A220_Common/Synaptic/A220/Lib/{Button,Knob,Switch,Lever}.xml`:

| Template | LVAR shape |
| --- | --- |
| `A220_Button` + `IS_LATCHED` (incl. `A220_ButtonPBA`, `A220_KnobRing`) | latched bool; `SET_STATE_EXTERNAL` toggles, `GET_STATE_EXTERNAL` reads. Read + write. |
| `A220_Button` without `IS_LATCHED` | momentary; writes `1` only. Write-only pulse. |
| `A220_Button` + `IS_HELD` | `1` on press, `0` on leave. Hold semantics. |
| `A220_Switch` (`NUM_STATES` default 2) | integer `0 ... NUM_STATES-1`. Read + write. `FLIP` and `IS_INVERTED` affect animation / mouse direction only — the transform is involutive, so LVAR meaning is stable. |
| `A220_KnobPotentiometer*` | `NUM_STATES 29`, `MULTIPLIER 1/28` -> **float 0.0 ... 1.0 in 1/28 steps**. |
| `A220_KnobLarge3State`, `KnobSmall3State`, `...4State`, `KnobBattery`(2) | integer `0 ... N-1`. `...4StateLooping` wraps. |
| `A220_KnobContinuous` with `<VAR>` | writes the signed delta `p0`. Write-only. |
| `A220_KnobContinuous` with `VAR_INC`/`VAR_DEC` | fires those (usually `H:` or `K:`) once per detent. |
| `A220_Lever` | `VAR_READ` / `VAR_WRITE` explicit; see individual entries. |

### Glareshield — FCP (autopilot) — `Glareshield/Autopilot.xml`

The FCP is driven almost entirely by **stock key events**, and mode state is exposed as
readable LVARs. This is the friendliest part of the aircraft for a profile.

| Control | Actuate with | Readback LVAR |
| --- | --- | --- |
| AP | `K:AP_MASTER` | `L:A22X AP Master` |
| A/T | `K:AUTO_THROTTLE_ARM` | `L:A22X AT Master` |
| Source XFR | `L:A22X FG Source Transfer` (momentary) | `L:A22X FG Source` (1 = L, 2 = R) |
| EDM | `L:A22X EDM` (momentary, guarded) | `L:A22X FG EDM` |
| FD capt / FO | `L:A22X L Flight Director`, `L:A22X R Flight Director` (momentary) | same names **[unverified: do they read back?]** |
| SPD knob | `K:AP_SPD_VAR_INC` / `K:AP_SPD_VAR_DEC`; absolute `K:AP_SPD_VAR_SET`, `K:AP_MACH_VAR_SET`, `K:AP_PANEL_MACH_SET` | — |
| SPD push (mach toggle) | `K:AP_MANAGED_SPEED_IN_MACH_TOGGLE` | — |
| SPD mode ring | `L:A22X FG Speed Mode` (latched bool) | same |
| HDG knob | `K:HEADING_BUG_INC` / `_DEC`; absolute `K:HEADING_BUG_SET`; sim var `A:AUTOPILOT HEADING LOCK DIR` | — |
| HDG push (sync) | `K:HEADING_BUG_SET` | — |
| HDG | `K:AP_HDG_HOLD` | `L:A22X FG Heading` |
| NAV | `K:AP_NAV1_HOLD` | `L:A22X FG LNAV` |
| APPR | `K:AP_APR_HOLD` | `L:A22X FG Approach` |
| BANK (half bank) | `K:AP_MAX_BANK_ANGLE_SET` | `L:A22X FG Half Bank` |
| ALT knob | `K:AP_ALT_VAR_INC` / `_DEC`; sim var `A:AUTOPILOT ALTITUDE LOCK VAR` | — |
| ALT push (fine) | `L:A22X FG Altitude Fine` (`BTN_TOGGLE True` -> latched bool) | same |
| ALT unit ring (ft / m) | `L:A22X FG Altitude Unit` (latched bool) | same |
| FLC | `K:FLIGHT_LEVEL_CHANGE` | `L:A22X FG Flight Level` |
| ALT | `K:AP_ALT_HOLD` | `L:A22X FG Altitude` |
| VNAV | `L:A22X FG VNAV Toggle` (momentary) | `L:A22X FG VNAV` |
| VS wheel | `K:AP_VS_VAR_INC` / `_DEC`; absolute `K:AP_VS_VAR_SET_ENGLISH` | `L:A22X FG Vertical Speed` |
| FPA | `K:AP_ATT_HOLD` | `L:A22X FG Flight Path Angle`; target `L:A22X Selected FPA` |
| TO/GA | `K:AUTO_THROTTLE_TO_GA` (also both thrust levers + a `TOGA_BIND_#INDEX#` clickspot) | — |
| A/T disconnect | `K:AUTO_THROTTLE_DISCONNECT` | — |
| AP disconnect (sidestick) | `K:AUTOPILOT_DISENGAGE_SET`, `K:AUTOPILOT_OFF` | — |
| FCP brightness | `L:A22X FCP Brightness` (pot 0-1) | — |
| FCP power / backlight | — | `L:A22X FCP Powered`, `L:A22X FCP Backlight` |

FCP JS bundle is fed by `A22X.FCP Data`.

### Glareshield — CTP (per side, `L` / `R`) — `Glareshield/CTP.xml`

| LVAR / H-var | Kind | Notes |
| --- | --- | --- |
| `L:A22X #SIDE# CTP Brightness` | pot 0-1 | |
| `L:A22X #SIDE# Altimeter Set/STD/HPA` | see baro section | |
| `L:A22X #SIDE# Nav Source` | momentary | NAV button cycles source |
| `L:A22X #SIDE# CTP Crosstune` | momentary | ACROSS |
| `L:A22X #SIDE# Inboard Partition` | read | `1` / `2` drive INDB_L / INDB_R lamps |
| `H:A220_CTP_TUNE_LARGE_#INDEX#_INC` / `_DEC` | H-event | tuning outer |
| `H:A220_CTP_TUNE_SMALL_#INDEX#_INC` / `_DEC` | H-event | tuning inner |
| `H:A220_CTP_RANGE_#INDEX#_INC` / `_DEC` | H-event | ND range |
| `H:A220_CTP_<ID>_#INDEX#` | H-event | `<ID>` in WXR, TERR, TFC, WX, TUNE, MAP, FMS, CNS, CHKL, SYN, DATA, LSK1-4, RSK1-3 |
| IDENT button | `K:XPNDR_IDENT_ON` | |

Channels: `A22X.L CTP Data` / `A22X.R CTP Data`, `A22X.L CTP State` / `A22X.R CTP State`.
WASM-side CTP LVAR suffixes (built as `"L:A22X " + side + " " + suffix`):
` CTP Tuner`, ` CTP Action`, ` Altimeter HPA`, ` Altimeter Set`, ` Altimeter STD`,
` Nav Source`, ` CTP Crosstune`, ` CTP Brightness`, ` CTP State`, ` CTP Backlight`.

### Glareshield — panel (per side) — `Glareshield/Panel.xml`

`L:A22X #SIDE# Inboard Brightness`, `L:A22X #SIDE# Outboard Brightness` (pots),
`L:A22X #SIDE# Chrono` (momentary), `L:A22X Master Caution Warning` (momentary, both sides),
`L:A22X #SIDE# Sidestick Priority` (momentary, guarded).
Lamps: `L:A22X Warning PBA`, `L:A22X Caution PBA` (XML flashes them at 1 Hz).
CPDLC buttons are H-events: `H:A220_FCU_CPDLC_{RJCT,STBY,ACPT,LOAD,REFRESH}`.

### Glareshield — gear panel — `Glareshield/Gear.xml`

| Control | Actuate | Read |
| --- | --- | --- |
| Gear lever | `K:GEAR_SET` (0/1) | `A:GEAR HANDLE POSITION` |
| Alternate gear | `L:A22X Alternate Gear` (switch, guarded) | same |
| Gear aural cancel | `L:A22X Gear Aural` (latched, guarded) | lamp `L:A22X Gear Aural Lamp` |
| Autobrake | `K:INCREASE_AUTOBRAKE_CONTROL` / `K:DECREASE_AUTOBRAKE_CONTROL`; also intercepted: `SET_AUTOBRAKE_CONTROL`, `AUTOBRAKE_DISARM`, `AUTOBRAKE_LO_SET`, `AUTOBRAKE_MED_SET`, `AUTOBRAKE_HI_SET` | `L:A22X Autobrake` (0-4) |
| NOSE STEER | `L:A22X Nose Steer Off` (latched) | lamp `L:A22X Nose Steer Off Lamp` |
| ALTN BRAKE | `L:A22X Alternate Brake` (latched, guarded) | lamp `L:A22X Alternate Brake Lamp` |

### ISI — `Glareshield/ISI.xml`

`H:A220_ISI_DOWN`, `H:A220_ISI_MENU`, `H:A220_ISI_UP`,
`L:A22X ISI Altimeter Set` (delta), `L:A22X ISI Altimeter STD` (momentary).
Also `L:A22X ISI Brightness` (pot, on pedestal), `L:A22X ISI ADS Reversion`.
Channel `A22X.ISI Data`. No `HPA` var on the ISI — the unit is changed through the ISI menu.

### Overhead

**Electrical** (`Overhead/Electrical.xml`)
- `L:A22X Bus Isolation Mode` — 3-state knob 0/1/2
- `L:A22X Cabin Power Off` — latched, guarded; lamp `... Lamp`
- `L:A22X RAT Gen` — latched, guarded; lamp `L:A22X RAT Gen Lamp`
- BATT 1 / BATT 2 knobs write **`A:ELECTRICAL MASTER BATTERY:1` / `:2`** directly (2-state).
  Standard `K:TOGGLE_MASTER_BATTERY` / `K:MASTER_BATTERY_SET` should work.
- `L:A22X L Gen Off`, `L:A22X R Gen Off`, `L:A22X APU Gen Off` — latched;
  lamps `L:A22X {L,R} Gen Fail Lamp`, `... Gen Off Lamp`, `L:A22X APU Gen {Fail,Off} Lamp`
- `L:A22X L Gen Disc`, `L:A22X R Gen Disc` — latched, guarded; lamps `... Oil Lamp`, `... Disc Lamp`
- `L:A22X External Power Toggle` — **momentary**; state in `L:A22X External Power Available`
  and `L:A22X External Power In Use`. GPU availability gate: `L:INI_GPU_AVAIL`.
- Other electrical readbacks in the WASM: `L:A22X RDC Powered`, `L:A22X <bus> Voltage`
  (indexed, name built at runtime), `L:A22X RAT Extension` (0-1), `L:A22X RAT RPM`,
  `L:A22X Circuit Breaker <n>`. Bus names in the binary include `DC Bus 2`, `DC Ess Bus 2`,
  `Batt Dir Bus 2`, `AC Ess Bus`, `DC Ess Bus 30`.

**Air / bleed / packs** (`Overhead/Air.xml`)
- Pots (0-1): `L:A22X Cockpit Air`, `L:A22X Fwd Cabin Air`, `L:A22X Aft Cabin Air`
- 4-state: `L:A22X Fwd Cargo Air`. 2-state: `L:A22X Aft Cargo Air`. 3-state: `L:A22X Crossbleed`
- Latched: `L:A22X Manual Temperature`, `L:A22X Trim Air Off`, `L:A22X Pack Flow`,
  `L:A22X Recirc Air Off`, `L:A22X Ram Air` (guarded), `L:A22X L Pack Off`, `L:A22X R Pack Off`,
  `L:A22X L Bleed Off`, `L:A22X R Bleed Off`, `L:A22X APU Bleed Off`
- Every one has a `... Lamp`, and `... Fail Lamp` where applicable
- WASM-only readbacks: `L:A22X Cockpit Trim Air Flow`,
  `L:A22X {Fwd Cabin,Aft Cabin,Fwd Cargo} Trim Air Flow`, `L:A22X Left Pack Flow`,
  `L:A22X Right Pack Flow`, `L:A22X Recirc Fan Speed`

**Anti-ice** (`Overhead/AntiIce.xml`) — 3-state knobs **[unverified ordering, presumably
OFF/AUTO/ON]**: `L:A22X L Cowl Anti Ice`, `L:A22X Wing Anti Ice`, `L:A22X R Cowl Anti Ice`.
Intercepted events: `ANTI_ICE_SET_ENG<n>`, `WINDSHIELD_DEICE_SET`, `TOGGLE_STRUCTURAL_DEICE`,
`PITOT_HEAT_SET`; sim var `STRUCTURAL DEICE SWITCH`.

**Heat** (`Overhead/Heat.xml`) — `L:A22X Probe Heat` (**momentary**, lamp `... Lamp`);
latched: `L:A22X {L,R} Side Window Heat Off`, `L:A22X {L,R} Windshield Heat Off`, each with a lamp.

**Hydraulics** (`Overhead/Hydraulics.xml`) — latched guarded `L:A22X Hyd 1 SOV`,
`L:A22X Hyd 2 SOV` (+ lamps); 3-state `L:A22X PTU`, `L:A22X ACMP 2B`, `L:A22X ACMP 3A`,
`L:A22X ACMP 3B`. WASM readbacks: `L:A22X PTU Running`, `L:A22X PTU Load`, `L:A22X ACMP <n> Load`.

**Fuel** (`Overhead/Fuel.xml`) — `L:A22X Manual Transfer` (4-state, looping),
`L:A22X L Boost Pump` / `L:A22X R Boost Pump` (3-state),
`L:A22X Gravity Transfer` (latched, lamp). WASM also touches `FUEL_SELECTOR_OFF`,
`FUEL TANK <name> QUANTITY`, `FUEL WEIGHT PER GALLON`.

**Fire** (`Overhead/Fire.xml`) — `L:A22X L Eng Fire`, `L:A22X R Eng Fire` (momentary, guarded);
latched: `L:A22X {L,R} Eng Fire Bottle {1,2}`, `L:A22X APU Fire` (guarded), `L:A22X APU Bottle 1`,
`L:A22X Cargo Fwd Fire` (guarded), `L:A22X Cargo Aft Fire` (guarded), `L:A22X Cargo Fire Bottle`.

**Pressurization** (`Overhead/Pressurization.xml`) — latched guarded `L:A22X Emergency Depress`,
`L:A22X Ditching`, `L:A22X Passenger Oxygen`; latched `L:A22X Man Press`
(lamps `L:A22X Auto Press Fail Lamp`, `L:A22X Man Press Lamp`); pot `L:A22X Manual Rate`.

**Flight controls (OVH)** — latched guarded `L:A22X PFCC 1 Off`, `... 2 Off`, `... 3 Off` (+ lamps).

**TAWS** — latched guarded `L:A22X TAWS {Gear,Terrain,Flaps} Inhibit`;
latched `L:A22X TAWS GS Inhibit`. All with `... Lamp`.

**APU** (`Overhead/APU.xml`) — `L:A22X APU Switch`, 3-state: **`0` = OFF, `1` = ON,
`2` = START**. Read this section before debugging it; the model is misleading.

```
VAR_READ:  (L:A22X APU Switch) 2 ==
           (E:SIMULATION TIME, second) (O:_MoveTime) - 3 >  and
           if{ 1 } els{ (L:A22X APU Switch) }
VAR_WRITE: (>L:A22X APU Switch)  (E:SIMULATION TIME, second) (>O:_MoveTime)
```

- The spring-return is **purely cosmetic** and lives in `VAR_READ`. The LVAR is never written
  back by the XML.
- `O:_MoveTime` is gauge-local and written **only** by `VAR_WRITE`, i.e. only from the mouse
  callback. A SimConnect write never refreshes it, so `simtime - _MoveTime > 3` is already
  true and the knob renders at the **ON** detent the instant the LVAR becomes `2`. The START
  position is never drawn for an external write. Judging success by the knob is a trap.
- Unlike `A220_Switch`, `A220_Knob` does **not** run a `UPDATE_CODE` that rewrites the LVAR —
  its update only drives `O:SwitchState`. Nothing in the model clobbers an external write.
- Consequence: a real mouse start leaves `L:A22X APU Switch` at `2` **permanently**, with the
  knob drawn at ON. So the WASM is almost certainly **edge-triggered on the transition into
  `2`** **[unverified]** — which means parking the var at `2` makes a later restart a no-op.
  Write `1` back ~1-2 s after the `2`.
- If the var reads back as `1` immediately, suspect **unit coercion**: writing an LVAR through
  a `Bool` or `Percent` unit collapses `2` to `1`. Write as `Number`.

Profile sequence: `0` -> `1` (door opens, ready) -> `2` -> `1`.

Readbacks: `L:A22X APU RPM`, `L:A22X APU Door`, `L:A22X APU Starter`, and `L:INI_APU_N1`
(used by `aircraft.cfg` exhaust FX). **The stock APU sim vars are dead** — `APU PCT RPM`,
`APU GENERATOR SWITCH`, `APU SWITCH` have zero occurrences in `systems.wasm`. No APU key
events are intercepted either. Related: `L:A22X APU Gen Off`, `L:A22X APU Bleed Off` (both
latched, with lamps), `L:A22X APU Fire`, `L:A22X APU Bottle 1`; checklist sensed token `APU_OFF`.

**Cooling** — latched `L:A22X Cooling Inlet` (lamp); 3-state `L:A22X Cooling Exhaust`.

**Lights (OVH)** (`Overhead/Lights.xml`)
- 2-state switches: `L:A22X Nav Lights`, `L:A22X Beacon Lights`, `L:A22X Strobe Lights`,
  `L:A22X Logo Lights`, `L:A22X Wing Insp Lights`, `L:A22X L Landing Lights`,
  `L:A22X R Landing Lights`, `L:A22X Nose Landing Lights`
- 3-state switches: `L:A22X Taxi Lights`, `L:A22X Seat Belt Lights`, `L:A22X No PED Lights`
- 3-state knob: `L:A22X Emergency Lights`
- Latched: `L:A22X Dome Lights` (annunciator `L:A22X Dome Lights Annunciator`)
- Momentary: `L:A22X Compass Lights`
- 3-state: `L:A22X Annun Lights` (WASM readback `L:A22X Annun Brightness`)
- Pots: `L:A22X {L,R} Reading Lights`, `L:A22X Entrance Lights`, `L:A22X CB Integral Lights`,
  `L:A22X Overhead Integral Lights`, `L:A22X {L,R} Map Lights`
- All eight 2-state light switches carry `FLIP = (L:INI_LIGHT_PANEL_OPTION)`. That only flips
  animation direction (the transform is involutive) — LVAR meaning is stable.
- Intercepted key events: `NAV_LIGHTS_SET`, `BEACON_LIGHTS_SET`, `STROBES_SET`,
  `LOGO_LIGHTS_SET`, `WING_LIGHTS_SET`, `TAXI_LIGHTS_SET`, `LANDING_LIGHTS_SET`,
  `LIGHT_POTENTIOMETER_SET`, `GLARESHIELD_LIGHTS_SET`

**Overhead misc** — latched guarded `L:A22X Aural Warn Inhibit` (lamp), `L:A22X Evac`
(lamp `L:A22X Evac Lamp`); 3-state knob `L:A22X Emer Transmitter` (event `ELT_SET`), test lamp
`L:A22X Emer Transmitter Test`; momentary `L:A22X CVR Test`, `L:A22X CVR Erase`,
`L:A22X Mech Call`; latched `L:A22X Service Intercom`.

**Wipers** — 4-state knobs `L:A22X_WIPER_L`, `L:A22X_WIPER_R` (underscores, not spaces).
`0` = park, `1/2/3` = increasing speed. Animation state in `L:A22X_WIPER_{L,R}_Anim`, `..._Back`,
`..._Park`, `..._Timer` — driven by a 60 Hz XML update loop, do not write.

### Pedestal

**Throttles** (`Pedestal/Throttles.xml`)
- Engine masters: read `L:A22X Engine 1 Master` / `L:A22X Engine 2 Master`,
  write `K:ENGINE_MASTER_1_SET` / `K:ENGINE_MASTER_2_SET`
  (WASM builds `ENGINE_MASTER_<n>_SET` and `ENGINE_MASTER_<n>_TOGGLE`)
- `L:A22X Eng Start Mode` — 3-state knob
- `L:A22X Continuous Ignition` — latched, lamp `... Lamp`
- `L:A22X Pilot Event` — `IS_HELD` (1 while held, 0 on release)
- Lever buttons -> `K:AUTO_THROTTLE_TO_GA`, `K:AUTO_THROTTLE_DISCONNECT`
- Throttle plumbing LVARs: `L:A22X Throttle Type`, `L:A22X Throttle L Raw`,
  `L:A22X Throttle R Raw`, `L:A22X Throttle {L,R} Idle`, `L:A22X Throttle {L,R} Rev Idle`,
  `L:A22X Throttle 1 TLA`, `L:A22X Throttle 2 TLA`
- Engine readbacks built at runtime: `L:A22X Engine <n> N1`, `... Ignition`, `... Starter`,
  `... Reverser`, `... Master`

**Pedestal flight controls** (`Pedestal/FlightControls.xml`)
- Parking brake: read `L:A22X Parking Brake`, write `K:PARKING_BRAKE_SET`
- Speedbrake lever: read `L:A22X Spoiler Lever` (0-1), write `K:SPOILERS_SET` with
  `(v - 0.5) * 32768` — unusual scaling, but that is what the template does
- Flap lever: read `A:FLAPS HANDLE INDEX` (0-5), write `K:FLAPS_SET` with `idx/5*16383`.
  Detents 0-5 = UP, 1, 2, 3, 4, 5
- `L:A22X Alternate Flap` — switch, guarded
- Trim readback `L:A22X Horizontal Stabilizer`

**MKP** (`Pedestal/MKP.xml`) — the full alphanumeric keypad, all H-events
`H:A220_KBD_<ID>_#INDEX#` where `<ID>` in `A..Z`, `0..9`, `DOT`, `SLASH`, `SPACE`,
`PLUS_MINUS`, `CLEAR` (held), `ENTER`, `CAS`, `MSG`, `ROUTE`, `DIR`, `DEP`, `MAP`, `FMS`,
`CNS`, `CHKL`, `SYN`, `DATA`, `UP`, `DOWN`, `LEFT`, `RIGHT`, `PREV`, `NEXT`.
Two exceptions are real LVARs: `L:A22X Flight Plan Cancel` (CNC) and
`L:A22X Flight Plan Execute` (EXEC), with `L:A22X Flight Plan Modified` as the EXEC-lamp
readback. **This is the FMS entry surface for a profile.**
`A22X_KEYBIND_TRIGGER` toggles the on-screen keyboard on the left MKP.

**CCP** (`Pedestal/CCP.xml`) — `H:A220_CCP_{MENU,DSPL_UPR,DSPL_LWR}_#INDEX#`,
`H:A220_DSK_LARGE_#INDEX#_{INC,DEC}`, `H:A220_DSK_SMALL_#INDEX#_{INC,DEC}`.

**RSP** (`Pedestal/RSP.xml`) — 3-state `L:A22X Reversion Mode`; momentary
`L:A22X Display Tune Inhibit` (readback `L:A22X Display Tune Inhibited`),
`L:A22X {L,R} ADS Reversion`, `L:A22X {L,R} IRS Reversion`, `L:A22X ISI ADS Reversion`;
`H:A220_RSP_INHIB_L` / `_R` (readbacks `L:A22X {L,R} Cursor Inhibit`).

**ACP** (`Pedestal/ACP.xml`) — `L:A22X ACP VHF{1,2,3}` (momentary),
`L:A22X ACP VHF{1,2,3} Volume` (pots), `L:A22X Tx Channel`
(1 = VHF1, 2 = VHF2, 3 = VHF3, 4 = HF1, 5 = HF2, 6 = SAT, 7 = CAB).
Sim var `PILOT TRANSMITTING`, event `PILOT_TRANSMITTER_SET`.

**Cockpit door** — momentary `L:A22X Cockpit Door Unlock`; `L:A22X Emer Access` (momentary,
lamp `L:A22X Emer Access Lamp`); open state `L:A22X Cockpit Door Open`.

**Pedestal lights** — pots `L:A22X Lower Brightness`, `L:A22X ISI Brightness`,
`L:A22X Pedestal Integral Lights`, `L:A22X Glareshield Integral Lights`, `L:A22X Flood Lights`.

**Oxygen** — `L:INI_OXYTEST_{CPT,FO}_N` (latched), `L:INI_OXYTEST_BLINKER_{CPT,FO}` (held),
`L:INI_OXYTEST_EMER_{CPT,FO}` (held).

### Misc cockpit

- Sidesticks: `L:A22X {L,R} Sidestick X`, `L:A22X {L,R} Sidestick Y` (percent, WASM-written).
  Disconnect button -> `K:AUTOPILOT_DISENGAGE_SET`. Tiller: `L:A22X L Tiller` (latched).
- `L:A22X Rudder Pedals` (percent, WASM-written).
- Flight-control surface readbacks: `L:A22X {L,R} Aileron`, `L:A22X {L,R} Elevator`,
  `L:A22X Rudder`, `L:A22X {L,R} MFS 1..4`, `L:A22X {L,R} GS`.
- Maintenance panel: `L:A22X Maint Mode` (3-state), `L:A22X Maint Channel` (3-state),
  `L:A22X Maint Batt Power` (switch), `L:A22X TPMU Disabled`.
- Blinds / interior: `L:A22X Side {L,R} Blind {1,2} State`, `L:A22X Cabin Curtain <ID>`,
  `L:A220_SATCOM_SHOWHIDE`, `L:CARGO_PANEL_FWD`, `L:CARGO_PANEL_AFT`.
- Displays: `L:A22X DU Backlight`, `L:A22X {L,R} {Inboard,Outboard} Brightness`,
  `L:A22X Lower Brightness`, `L:A22X Mono`, `L:A22X Mono CTP`, `L:A22X DU<n> Data`.
- Global: `L:A22X Flight Stage` (the aircraft's own flight-phase enum — prefer it over
  inferring phase; **[unverified] value mapping**), `L:A22X Lamp Test`, `L:A22X ZFW CG`,
  `L:A22X NLG Door`, `L:A22X Paused at TOD`, `L:A22X Evac`.

### Aural cue LVARs

A very large set, all `L:A22X Aural <name>` — pulse flags the WASM sets to trigger a sound.
**Potentially the best event-trigger surface in the aircraft.** Duration / latching
**[unverified]**.

```
Radio Alt  Decision Height  Approaching Decision Height  Decide  Minimum  Minimums
Minimums Minimums  Approaching Minimums
2500 1000 500 400 300 200 100 80 60 50 40 35 30 20 10 5  Above 100  Above 50
Sink Rate  Pull Up  Terrain Terrain  Dont Sink  Too Low Terrain  Too Low Gear  Too Low Flap
Glideslope  Bank Angle  Caution Terrain  Windshear  Stall
Cockpit Door  Emergency Descent  AP Disengage  Flare  Standby  Dual Input
Overspeed  Overspeed Pre Alert  Speed  Speed x3
Left Engine Fire  Right Engine Fire  APU Fire  Cargo Fire  Smoke  Gear Bay Overheat
Cabin Pressure  Cabin Altitude  Warning  Caution
Approach Degraded  Not A Runway  Short Runway  Runway Disagree
Quadruple Tone x3  Altitude  Vertical Track  Altitude Capture
Config Trim  Config Sidestick  Config Flaps  Config Spoilers  Config Brakes
Config Autopilot  Config Autothrottle  Config Thrust Lever
AT Disengage Auto  AT Disengage Manual  Gear  Emergency Evac
Priority Left  Priority Right  V1  Trim Timeout  Selcal  Thrust Lever
Internal Test  Warning Test 1  Warning Test 2
```

### `L:INI_*` — EFB options and iniBuilds-common vars

```
INI_ACCEL_HEIGHT_OPTIONS       INI_AP_AT_DISCONNECT_PROTECTION  INI_APU_N1
INI_AUTOSAVE_ENABLED           INI_AUTOSAVE_INTERVAL            INI_AUTO_GPU_DISCONNECT
INI_AUTO_INSERT_STEP_CLIMBS    INI_AUTO_STEP_CLIMB_ENABLED      INI_AUTO_TIME_COMPRESSION_ENABLED
INI_AUTO_TIME_COMPRESSION_RATE INI_BARO_SYNC_OPTION             INI_CABIN_LIGHTING_OPTION
INI_CHOCKS_ENABLED             INI_CONDENSATION_EFFECTS         INI_COVERS_ENABLED
INI_COVERS_ON                  INI_CPDLC_SOURCE                 INI_DIRT_LEVEL
INI_EFB_ACTUAL_BRIGHTNESS_CPT  INI_EFB_ACTUAL_BRIGHTNESS_FO     INI_EFB_SIM_RATE_TARGET
INI_EFB_STATE                  INI_EFB_TOD_PAUSE_ACTIVE         INI_EIS_VERSION
INI_FLIGHT_PROGRESS_EFB        INI_FMC_RESET                    INI_FX_PERF_MODE
INI_FX_VISIBILITY              INI_GPU_AVAIL                    INI_IRS_ALIGNMENT_TIME
INI_IS_METRIC                  INI_LIGHT_PANEL_OPTION           INI_LINKED_INSTRUMENTS
INI_MCDU_OPTION                INI_NAVDATA_OPTION               INI_NG_NAVDATA_UPDATE
INI_NSW_SETTING                INI_OPTION_BRAKE_FANS            INI_OPTION_EIS1_PVI
INI_OPTION_ICE_DETECTORS       INI_OPTION_ISIS                  INI_PAUSE_AT_TOD_DISTANCE
INI_PAUSE_AT_TOD_ENABLED       INI_POTENTIOMETER_92             INI_PREFERRED_SEAT
INI_PRINTER_AUTOPRINT_FPLAN_INIT  INI_PRINTER_AUTOPRINT_TODATA  INI_PRINTER_AUTOPRINT_WIND
INI_REALISTIC_DOOR_ARMING      INI_SHOW_THROTTLE_POS_ON_EICAS   INI_SOUND_TOGGLE_NOISE_CANCELLATION
INI_START_TURNAROUND           INI_STREAMER_MODE                INI_THRUST_CONFIG
INI_USE_NAVIGRAPH_CHARTS       INI_VAPP_SPEED                   INIB_AUTO_TILLER_DISCONNECT
```

The WASM itself reads only `INI_BARO_SYNC_OPTION`, `INI_GPU_AVAIL`, `INI_IRS_ALIGNMENT_TIME`,
`INI_IS_METRIC`, `INI_PAUSE_AT_TOD_ENABLED`, `INI_PAUSE_AT_TOD_DISTANCE`,
`INI_SHOW_THROTTLE_POS_ON_EICAS`, `INI_AP_AT_DISCONNECT_PROTECTION`. The rest are consumed by
the EFB / JS.

Present in the EFB bundle but **probably inert on this airframe** (shared iniBuilds EFB code;
the A220's FMS is the Synaptic Rust one and talks over `A220.EFB FMS *` CommBus):
`L:FMS_{V1,VR,V2,FLAPS,FLEX,THS,SEND_TO}_PERF`, `L:FMGS_*`, `L:WTAP_*` (stock Working Title
autopilot vars), `L:XMLVAR_SpeedIsManuallySet`, `L:XMLVAR_VNAVButtonValue`,
`L:AUTOPILOT_ACTIVE_MODE`, `L:CABIN_COLOR`, `L:FLIGHTSTART`, `L:IS2024`.
Sound: `L:A22X_VOLUME_{ENGINES,ENVIRONMENT,RATTLES}`. Keybinds: `L:A22X_KEYBIND_SET`.

## Input events (`B:`)

The model behaviours reference these literally, so the prefix is confirmed:
`B:AIRLINER_<NODE_ID>_Set`, `B:AIRLINER_<NODE_ID>`, `B:AIRLINER_<NODE_ID>_Cover_Toggle`.
Button/knob templates go through `ASOBO_AIRLINER_Base_Template` with `IE_NAME = <NODE_ID>` and
`IS_AIRLINER True`. Asobo's own template files are **not on disk** (MSFS 2024 streams package
content), so the exact sub-event suffixes must be enumerated at runtime via SimConnect's
`EnumerateInputEvents`.

**Important asymmetry [unverified but strongly implied by the code]:**

- For `A220_Button` / `A220_KnobContinuous` (via `ASOBO_AIRLINER_Base_Template`),
  `SET_STATE_EXTERNAL` writes the LVAR — so setting the input event *does* actuate.
- For `A220_Switch`, the input event's `SET_STATE_ON/OFF` only writes `O:SwitchState`, while a
  4 Hz `UPDATE_CODE` continuously pushes the LVAR back into it. The LVAR write lives in
  `CALLBACK_CODE`, which only the mouse rect invokes. So **setting a switch's input event
  should not stick** — write the LVAR instead.

Guarded switches expose a separate cover input event with `GET_STATE_EXTERNAL` on `O:GuardState`.

## Key events the WASM intercepts

Everything below appears as a literal string in `systems.wasm`, i.e. the module registers a
handler. Anything *not* here falls through to default sim behaviour (or does nothing).

```
Autopilot   AP_MASTER  AUTO_THROTTLE_ARM  AP_SPD_VAR_INC  AP_SPD_VAR_DEC  AP_SPD_VAR_SET
            AP_MACH_VAR_SET  AP_PANEL_MACH_SET  AP_MANAGED_SPEED_IN_MACH_TOGGLE
            HEADING_BUG_INC  HEADING_BUG_DEC  HEADING_BUG_SET  AP_HDG_HOLD  AP_NAV1_HOLD
            AP_APR_HOLD  AP_MAX_BANK_ANGLE_SET  AP_ALT_VAR_INC  AP_ALT_VAR_DEC
            FLIGHT_LEVEL_CHANGE  AP_ALT_HOLD  AP_VS_VAR_INC  AP_VS_VAR_DEC
            AP_VS_VAR_SET_ENGLISH  AP_VS_HOLD  AP_ATT_HOLD
            AUTOPILOT_DISENGAGE_SET  AUTOPILOT_OFF
Throttle    AXIS_THROTTLE_{MINUS,PLUS,SET}  AXIS_THROTTLE{1,2}_SET  {DECREASE,INCREASE}_THROTTLE
            THROTTLE_{INCR,DECR}  THROTTLE{1,2}_{INCR,DECR}  THROTTLE_{10..90}
            THROTTLE{,1,2}_AXIS_SET_EX1  THROTTLE{,1,2}_CUT{,_EX1}
            THROTTLE{,1,2}_DECR_SMALL / _DECREASE_EX1 / _DECREASE_SMALL_EX1
            THROTTLE{,1,2}_FULL{,_EX1}  THROTTLE{,1,2}_INCREASE_EX1 / _INCR_SMALL
            THROTTLE{,1,2}_INCREASE_SMALL_EX1  THROTTLE{,1,2}_SET
            AUTO_THROTTLE_TO_GA  AUTO_THROTTLE_DISCONNECT
            SET{,_THROTTLE1,_THROTTLE2}_REVERSE_THRUST_{ON,OFF}
            THROTTLE_REVERSE_THRUST_TOGGLE  TOGGLE_THROTTLE{1,2}_REVERSE_THRUST
            THROTTLE{,1,2}_REVERSE_THRUST_HOLD
Flight ctl  AILERON_SET  ELEVATOR_SET  RUDDER_SET  AXIS_AILERONS_SET  AILERONS_{LEFT,RIGHT}
            AXIS_ELEVATOR_SET  ELEVATOR_{UP,DOWN}  AXIS_RUDDER_SET  RUDDER_{LEFT,RIGHT}
            RUDDER_AXIS_{PLUS,MINUS}  ELEVATOR_TRIM_SET  ELEV_TRIM_{UP,DN}  AXIS_ELEV_TRIM_SET
            SPOILERS_ARM_{OFF,ON,SET,TOGGLE}  AXIS_SPOILER_SET
            SPOILERS_{SET,DEC,INC,OFF,ON,TOGGLE}
            AXIS_FLAPS_SET  FLAPS_SET  FLAPS_{1,2,3}  FLAPS_{DECR,INCR,UP,DOWN}
Brakes      AXIS_{LEFT,RIGHT}_BRAKE_SET  BRAKES  BRAKES_{LEFT,RIGHT}  PARKING_BRAKES
            PARKING_BRAKE_SET  AUTOBRAKE_DISARM  AUTOBRAKE_{HI,MED,LO}_SET
            {INCREASE,DECREASE,SET}_AUTOBRAKE_CONTROL
Steering    AXIS_STEERING_SET  STEERING_SET  STEERING_{INC,DEC}
Engine      ENGINE_MASTER_<n>_SET  ENGINE_MASTER_<n>_TOGGLE  FUEL_SELECTOR_OFF
Ice/heat    ANTI_ICE_SET_ENG<n>  PITOT_HEAT_SET  WINDSHIELD_DEICE_SET  TOGGLE_STRUCTURAL_DEICE
Lights      NAV_LIGHTS_SET  BEACON_LIGHTS_SET  STROBES_SET  LOGO_LIGHTS_SET  WING_LIGHTS_SET
            TAXI_LIGHTS_SET  LANDING_LIGHTS_SET  LIGHT_POTENTIOMETER_SET  GLARESHIELD_LIGHTS_SET
Radio       COM<n>_RADIO_SWAP / _RADIO_SET / _RADIO_SET_HZ / _RADIO_WHOLE_{INC,DEC}
            / _RADIO_FRACT_{INC,DEC}{,_CARRY}  COM<n>_STBY_RADIO_SET  COM_STBY_RADIO_SWAP
            PILOT_TRANSMITTER_SET  MARKER_BEACON_SENSITIVITY_HIGH
Transponder XPNDR_{1,10,100,1000}_{INC,DEC}  XPNDR_{INC,DEC}_CARRY  XPNDR_SET  XPNDR_IDENT_ON
Misc        ELT_SET
```

Conspicuously **absent** (so these are LVAR-only, sim-default, or unimplemented): APU start
events, fuel-pump events, `TOGGLE_MASTER_BATTERY` variants (batteries use the sim var
directly), gear events beyond `GEAR_SET` fired from XML, pushback, jetway,
`TOGGLE_AIRCRAFT_EXIT` (handled by the sim; the cabin door XML fires it).

## Sim vars the WASM reads or writes

```
PRESSURE ALTITUDE            AMBIENT TEMPERATURE        AMBIENT PRESSURE
DYNAMIC PRESSURE             SEA LEVEL PRESSURE         AMBIENT WIND
ZULU YEAR                    ZULU DAY OF YEAR           PLANE ALTITUDE
PLANE ALT ABOVE GROUND       PLANE ALT ABOVE GROUND MINUS CG
AIRSPEED MACH                VELOCITY WORLD             ACCELERATION BODY    G FORCE
TOTAL WEIGHT                 PAYLOAD STATION WEIGHT:0..4                     CG PERCENT
FUEL WEIGHT PER GALLON       FUEL TANK <name> QUANTITY
ELECTRICAL MASTER BATTERY:1  ELECTRICAL MASTER BATTERY:2   EXTERNAL POWER ON:1
TURB ENG CORRECTED N1:<n>    TURB ENG CORRECTED N2:<n>     GENERAL ENG EXHAUST GAS TEMPERATURE:<n>
GEAR IS ON GROUND:0..2       GEAR {CENTER,LEFT,RIGHT} POSITION   GEAR HANDLE POSITION
FLAPS HANDLE INDEX           RUDDER POSITION            WHEEL RPM:<n>
STRUCTURAL ICE PCT           STRUCTURAL DEICE SWITCH
INTERACTIVE POINT OPEN:<n>   SIM ON GROUND              MAGNETIC COMPASS
TRANSPONDER IDENT:1          TRANSPONDER STATE:1        ATC ID
NAV HAS DME:<n>              MARKER BEACON STATE        PILOT TRANSMITTING
AUTOPILOT ALTITUDE LOCK VAR  AUTOPILOT HEADING LOCK DIR
```
Units seen: `pascal`, `g force`, `pound`, `liter`, `meter`, `degree per second`,
`meter per second squared`, `percent over 100`, `number`.

## CommBus channels

Published by the WASM (JS subscribes). All JSON. **Unreachable from SimConnect.**

```
A22X.CAS Data        A22X.Air Data          A22X.Electrical Data   A22X.Fuel Data
A22X.Hydraulic Data  A22X.Flight Control Data  A22X.Status Data    A22X.Autoflight Data
A22X.L Nav Data      A22X.R Nav Data        A22X.L PFD Data        A22X.R PFD Data
A22X.Anti Ice Data   A22X.Gear Data         A22X.Radio Data        A22X.Doors Data
A22X.L CTP Data      A22X.R CTP Data        A22X.Avionic Data      A22X.L ADS Data
A22X.R ADS Data      A22X.L IRS Data        A22X.R IRS Data        A22X.Engine Data
A22X.ATC Data        A22X.ATC Traffic       A22X.ISI Data          A22X.FCP Data
A22X.DU<n> Data      A22X.Data Storage      A22X.Configure
```

Command channels (JS -> WASM):
```
A22X.SSPC Push  A22X.SSPC Pull  A22X.Display Tune  A22X.CAS Acknowledge
A22X.Aural Test  A22X.Lamp Test  A22X.Weather Test  A22X.TAWS Test
A22X.Wing Anti Ice Test  A22X.Ice Detect Test  A22X.Fire Test
A22X.Flight Control Test  A22X.Shaker Test
A22X.Refuel {Request,Accept,Start,Stop}
A220.Nav Data {Request,Response}    A220.Navigraph Download{,Progress,Success}
A220.Flight Plan {Request,Response,Update,Path,Path Reproject,Debug Path,Status}
A220.EFB FMS {Request,Response,Set TO Perf}
A220.FMS {Allowed Sensors,Position}
```
(`L:A220 Nav Data Source` selects the nav database source.)

### Known field names per channel (partial, from the serde tables)

- **PFD**: `same_source altitude_m qnh_hpa qnh_inhg qnh_misconfig_set qnh_misconfig_std tat sat
  airspeed_trend v_min_trim v_aoa_soft v_aoa_hard v_ld_max`
- **ADS**: `altitude_rate angle_of_attack isa_dev airspeed_indicated airspeed_true
  airspeed_mach v_max`
- **Engine**: `sync_enabled max_egt thrust_manual thrust_flex
  eng<n>_{n1,n1_cmd,n1_ref,n1_tlls,n1_axis,n2,egt,fuel_flow,oil_temp,oil_press,max_oil_temp,
  max_oil_press,start,apr,relight,ats,windmill,rev,ign}
  to_n1 ga_n1 mct_n1 clb_n1 clb1_n1 clb2_n1 alt_aae`
  plus `{l,r}_eng_oil_{temp,press,qty}` (+ `_color`) and
  `apu_{rpm,egt,door,oil_temp,oil_press,oil_qty}` (+ `_color`)
- **Autoflight**: `lateral lateral_appr lateral_arm lateral_arm_appr approach_status vertical
  vertical_vnav vertical_capture vertical_arm_hold vertical_arm_hold_vnav vertical_arm_vert
  vertical_arm_vert_vnav vertical_arm_appr vertical_arm_appr_vnav vnav_invalid vpath_invalid
  vnav_target_alt_ft vnav_target_alt_m vnav_target_vs_fpm vnav_target_spd_ias
  vnav_target_spd_mach vnav_target_spd_in_mach cmd_lateral cmd_vertical_fpa cmd_vertical_pitch
  cmd_rollout at_mode at_mode_armed l_fdr_fd ap_master ap_disengage at_master at_disengage`
- **Hydraulic**: `hyd<n>_{temp,qty,press}` (+ `_color`), `edp_1a edp_2a acmp_2b acmp_3a acmp_3b
  ptu rat_show rat sov1 sov2 ptu_sov` (+ `_color`)
- **Gear / tyres**: `nose_{icon,color,l_tire_color,r_tire_color,l_tire_press,r_tire_press}`,
  `{left,right}_{icon,color,outb_tire_color,inbd_tire_color,outb_brake_color,inbd_brake_color,
  outb_tire_press,inbd_tire_press,outb_brake_temp,inbd_brake_temp}`
- **Nav / CTP**: `preview_{source,course,frequency,cdi,vdi}`,
  `brg{1,2}_{source,course,distance}`, `powered brightness ads_source nav_source crosstune
  fms_sensor fms_position fms_gs fms_heading`
- **ATC / XPDR**: `xpdr1 xpdr2 tss_mode tss_limits_sel tss_limits tss_other_tfc tss_alt_abs
  tss_test tss_advisory`

## Rust module map (from panic paths in `systems.wasm`)

```
sim/{wasm_main,lifecycle,variable/comm_bus,interface/impl/{mod,comm/mod,network,
     simconnect/{mod,facilities/{map,queue}}}}
ads  irs  fsm  util  drm  sentry  iccp  doors  brake  lights  landing_gear
apu/mod   bleed/{mod,anti_ice}   engine/eec   fuel/mod   hydraulic/mod   flaps/{mod,pdu}
efcs/{pcu,pfcc,rvdt,modes/{normal,state}}
electrical/{mod,cb,fbwpc,network/mod,control/{gcu,bpcu/{mod,_1,_2,empc},
            cdc/{mod,_1.._5,sspc_control}}}
comms/{mod,analog,arinc429,can,discrete,ttp}
data/{ipc,taws,dmc/{mod,autoflight/{mod,lateral}}}
displays/{mod,du,variables}
radio/{vhf,atc/mod}
fms/{mod,position,utils,fpln/{mod,interface,legs,segments},guidance/{mod,path},
     uplink/{mod,simbrief,simulator},
     database/{mod,types,native,custom/{mod,sqlite},navigraph/{mod,map,sqlite}}}
registry/{mod,arena,storage}
```

Notable: real ARINC-429 / CAN / discrete signalling between LRUs, a full EFCS with PFCCs and
PCUs, per-contactor electrical control (CDC 1-5, BPCU, GCU, SSPC), a SimBrief uplink, and both
Navigraph and a bundled custom SQLite nav database (`\work/synaptic.s3db`). There is a `drm`
module and a `sentry` module (crash telemetry) — the Sentry headless gauge in `panel.cfg`
pairs with the latter.

## Radios and transponder

**There are no frequency LVARs.** Tuning is entirely H-events on the CTP:
`H:A220_CTP_TUNE_LARGE_<1|2>_{INC,DEC}` (outer), `H:A220_CTP_TUNE_SMALL_<1|2>_{INC,DEC}`
(inner), `H:A220_CTP_TUNE_<1|2>` (TUNE button), `L:A22X <L|R> CTP Crosstune` (ACROSS,
momentary). It is a cursor-driven tuning window, so blind tuning also requires knowing which
field the cursor is on — same relative-not-absolute problem as baro.

Frequencies live on `A22X.Radio Data`. Per-radio fields:
`tx datalink squelch spacing standby active ident autotune marker_sensitivity`,
plus a `vhf` array and `l_ctp_inhib` / `r_ctp_inhib` / `display_tune_inhib`.
`COM ACTIVE FREQUENCY` / `NAV ACTIVE FREQUENCY` do not appear anywhere in the six JS bundles,
not even as SDK boilerplate — the displays read only the CommBus.

**Do the sim's radio vars still mirror?** The WASM builds prefixes `COM1 COM2 COM3 NAV1 NAV2`
with suffixes `_RADIO_SET`, `_RADIO_SET_HZ`, `_RADIO_SWAP`, `_RADIO_WHOLE_{INC,DEC}`,
`_RADIO_FRACT_{INC,DEC}{,_CARRY}`, `_STBY_RADIO_SET`, `COM_STBY_RADIO_SWAP`. Strings cannot
distinguish interception from emission — both need the literal name. But:

- **NAV: almost certainly mirrored.** The WASM reads a dozen sim nav-receiver outputs
  (`NAV RADIAL`, `NAV HAS LOCALIZER`, `NAV HAS GLIDE SLOPE`, `NAV GLIDE SLOPE ERROR`,
  `NAV RAW GLIDE SLOPE`, `NAV IDENT`, `NAV MAGVAR`, `NAV VOR LATLONALT`, `NAV DME`,
  `NAV DMESPEED`, `NAV HAS DME`, `NAV LOCALIZER`). Those are only meaningful if the sim's
  NAV1/NAV2 are tuned to the crew's selection, and emitting `NAV<n>_RADIO_SET_HZ` is the only
  mechanism available. So `A:NAV ACTIVE FREQUENCY:1/:2` should be readable and truthful.
  **[unverified but structurally implied]**
- **COM: unproven.** The WASM reads nothing back from the sim's COM stack. The practical
  argument for mirroring is strong (MSFS ATC and online clients read the sim COM vars), but it
  is an argument, not evidence. Test before relying on `A:COM ACTIVE FREQUENCY:<n>`.
- **Transponder: probably stale.** `TRANSPONDER CODE` does not occur in the binary at all —
  only `TRANSPONDER STATE:1` and `TRANSPONDER IDENT:1`. The squawk is held internally and
  `XPNDR_SET` plus the digit inc/dec events are intercepted. Assume `A:TRANSPONDER CODE:1`
  does not follow the cockpit.

Unaccounted-for LVARs the WASM registers: `L:A22X <L|R> CTP Tuner` and
`L:A22X <L|R> CTP Action`. Given the `CtpAction` enum (see the altimeter section), if
`CTP Action` is a writable numeric action selector it would be a second and much richer route
into the CTP — baro, minimums, landing elevation, course, nav source. Speculative; probe it.

## Doors

The WASM reads `A:INTERACTIVE POINT OPEN:<n>`. `Lib/Doors.xml` gives the mapping:

| Interactive point (0-based) | Door | `K:TOGGLE_AIRCRAFT_EXIT` arg (1-based) |
| --- | --- | --- |
| 0 | DOOR 1L (fwd pax, left) | 1 |
| 1 | DOOR 1R | 2 |
| 2 | DOOR 2L (aft pax, left) | 3 |
| 3 | DOOR 2R | 4 |
| 4 | AFT cargo | 5 |
| 5 | FWD cargo | 6 |
| 6 | L overwing emergency exit | 7 |
| 7 | R overwing emergency exit | 8 |
| 8, 9 | service points (types 4 and 3 in `flight_model.cfg`), not pax doors | — |

`Cabin/Doors.xml` fires `#ID# (>K:TOGGLE_AIRCRAFT_EXIT)` gated on `A:SIM ON GROUND` —
**note the off-by-one: `INTERACTIVE_ID = ID - 1`.** `aircraft.cfg` declares
`number_of_exits = 4`; `flight_model.cfg` declares `number_of_interactive_points = 10`.
Door arming behaviour is affected by `L:INI_REALISTIC_DOOR_ARMING`.
The `A22X.Doors Data` channel carries `doors_r2_open` and friends.

## Built-in electronic checklist

`Config/Default/checklists.json`, `name "Synaptic Default - BCS3 (KG)"`,
`partNumber "ECL_BCS3_SYN_072826_KG"`. 14 normal checklists, 17 non-normal groups
(~279 abnormal checklists). Items carry a `sensed` token evaluated inside the WASM — these
names are a useful vocabulary even though they are not readable vars:

```
PARK_BRAKE_ON  BATT_1_AUTO  BATT_2_AUTO  BATT_1_OFF  BATT_2_OFF
HYD_PTU_AUTO  HYD_3A_AUTO  HYD_3B_AUTO  HYD_2B_AUTO  HYD_3A_OFF  HYD_3B_OFF  HYD_2B_OFF
LANDING_GEAR_LEVER_UP  LANDING_GEAR_LEVER_DOWN  THRUST_LEVERS_IDLE
L_ENG_RUN_ON  R_ENG_RUN_ON  SEAT_BELTS_ON  SEAT_BELTS_OFF  ALL_DOORS_CLOSED  BEACON_LTS_ON
NOSE_STEER_OFF  SLAT_FLAP_LEVER_0  L_COWL_AUTO  R_COWL_AUTO  WING_AUTO  WING_OFF
INLET_OFF  EMER_LIGHTS_OFF  APU_OFF  DOME_ON
```

Normal checklists and phases:
`Power-on`, `Preflight`, `Before start`, `Before taxi`, `Before takeoff` (pre-flight);
`After takeoff`, `High altitude climb check (above FL350)`, `Descent and approach`,
`Before landing`, `After go-around` (in-flight);
`After landing`, `Shutdown`, `Power-off`, `Partial power-off` (post-flight).

Power-on flow, in order: PARK BRAKE ON / BATT 1 AUTO / BATT 2 AUTO / ECL on DU 2 / PTU AUTO /
HYD 3A AUTO / HYD 3B AUTO / HYD 2B AUTO / gear lever DN / thrust levers IDLE / L ENG RUN OFF /
R ENG RUN OFF / APU or EXT PWR as required / EQUIP COOLING INLET select auto.

Non-normal groups (count): air-conditioning/bleed/press (37), aural/visual warning (1),
AFCS (3), APU (6), doors (11), electrical (20), fire protection (17), flight controls (37),
fuel (14), hydraulic power (18), ice and rain (21), instruments (33),
landing gear/wheel/brake (18), misc (3), navigation (14), power plant (31),
smoke/fire/fumes (5).

## Airframe numbers (from `.cfg`)

- Engines: **PW1524G-3**, `static_thrust = 24400` lbf, `low_idle_n1 = 19.5`,
  `low_idle_n2 = 61.5`, `rated_N2_rpm = 19391`, `reverser_available = 0.6`.
- `max_gross_weight = 154000` lb, `empty_weight = 81750` lb, CG limits 0.16 - 0.40 MAC.
- Payload stations: 0 pilot (170), 1 copilot (170), 2 Economy front (6115), 3 FWD baggage
  (3505), 4 Economy back (4000), 5 AFT baggage (6500).
- Fuel: `LeftMain 1004`, `RightMain 1004`, `Center1 3748` (US gal), `fuel_type = 2` (Jet A).
- Reference speeds: `cruise_mach 0.78`, `max_mach 0.82`, `max_indicated_speed 350`,
  `normal_operating_speed 320`, `crossover_speed 300`, `max_flaps_extended 215`,
  `max_gear_extended 250`, `cruise_alt 41000`.
- Flap detents (flap deg / max KIAS): F1 0/230 (slats 21), F2 10/210, F3 15/210, F4 25/190,
  F5 37/170.
- Services declared: fuel truck, baggage loader, catering, boarding ramp, GPU, pushback,
  marshaller, jetway.

## Implications for the FS Copilot profile

1. **Reads are the scarce resource.** Switch positions, lamps, and a handful of scalars are
   available; anything the crew reads off a display (speeds, altitudes, QNH, N1, hyd
   pressures, CAS) is not. Design around commanding + LVAR readback of *switch state*, not
   around reading instruments.
2. **Autopilot is fully drivable** with stock `K:` events and has clean `L:A22X FG *`
   readbacks. Best-supported area of the aircraft.
3. **FMS entry is possible** keystroke-by-keystroke via `H:A220_KBD_*` plus
   `L:A22X Flight Plan Execute` / `Cancel`, with `L:A22X Flight Plan Modified` as the
   EXEC-armed indicator. Slow but deterministic.
4. **Baro is open-loop** unless the CommBus bridge is built (see the altimeter section).
5. **Aural cue LVARs** are the closest thing to an event stream — worth wiring as triggers
   (V1, minimums, approaching minimums, config warnings, AP/AT disengage).
6. `L:A22X Flight Stage` is the aircraft's own flight-phase enum; prefer it over inferring
   phase from sim vars.
7. Prefer LVAR writes over `B:` input events for anything built on `A220_Switch`.
8. Momentary LVARs (`1 (>VAR)`) need no reset from the writer — the WASM consumes them.
   **[unverified]** whether two writes in one tick coalesce.
9. The checklist `sensed` token list is a good spec for which states the aircraft itself
   considers meaningful; mirror those in profile conditions.

## Verification backlog

- [ ] `... Altimeter Set` consume-and-reset vs edge-trigger; detent size per unit mode.
- [ ] `... Altimeter HPA` polarity; `... Altimeter STD` toggle vs set.
- [ ] `L:INI_BARO_SYNC_OPTION` value set and whether it drags the ISI along.
- [ ] `L:A22X Flight Stage` enum values.
- [ ] 3-state knob orderings (anti-ice OFF/AUTO/ON, boost pumps, PTU, crossbleed, reversion,
      eng start mode, emergency lights).
- [ ] `L:A22X APU Switch`: is the WASM edge-triggered on the transition into `2`, or level-
      triggered? Decides whether the var must be returned to `1` for a restart to work.
      (See the APU section — the XML spring-return is cosmetic and leaves the LVAR at `2`.)
- [ ] Whether `B:AIRLINER_*_Set` actuates `A220_Switch`-based controls.
- [ ] Aural LVAR pulse duration / latching.
- [ ] Do the FD LVARs (`L:A22X {L,R} Flight Director`) read back, or are they write-only?
- [ ] Whether `L:FMS_*_PERF` / `L:WTAP_*` are genuinely inert here.
- [ ] Do `A:COM ACTIVE FREQUENCY:<n>` and `A:NAV ACTIVE FREQUENCY:<n>` follow the cockpit?
      (NAV expected yes, COM unknown, `A:TRANSPONDER CODE:1` expected no.)
- [ ] What are `L:A22X <L|R> CTP Tuner` and `L:A22X <L|R> CTP Action`? If `CTP Action` accepts
      a written action index it may reach the whole `CtpAction` enum, baro included.
