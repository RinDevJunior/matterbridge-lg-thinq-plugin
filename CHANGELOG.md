# Changelog

## [Unreleased]

## [0.1.1-rc04] - 2026-10-21

### Added

- **Personal Access Token (PAT) login type** — a new `pat` login type for the official ThinQ Connect API, in the plugin config and the CLI (`login --type pat`).
- **Air conditioners with PAT login** — ThinQ Connect air conditioners are registered with power, target temperature (Celsius), fan speed, swing, room temperature, humidity (where reported) and read-only filter life. Home shows Cool and Off.
- **ThinQ Connect container with Google Home washer on/off** — with PAT login, the washer on/off can be controlled from Google Home; state is polled every `refreshIntervalSeconds` (minimum 15 s).
- **Washer state in Matter (ThinQ Connect)** — the washer shows Running, Paused, Stopped or Error, plus time left and errors. It is read-only, and unknown states show Stopped.
- **Washer Start/Stop from Matter (ThinQ Connect)** — Start works only when the washer is idle with Remote Start on, and Stop sends STOP. Pause and Resume are refused, and if LG refuses a command the real state is shown again. START is not yet tested on hardware.
- **`ignore` setting for ThinQ Connect washers** — the `ignore` setting now works for ThinQ Connect washers.
- **ThinQ Connect devices in the settings device list** — devices get entries in the plugin settings device list automatically (new ids only, existing values are never changed), and the settings page shows the device list for the PAT login.
- **Air conditioner room temperature sensor (ThinQ Connect)** — a room temperature sensor is added when the air conditioner reports it.
- **`connect-probe` and `connect-control` CLI commands** — `connect-probe` is a read-only check of the device profile and state; `connect-control` sends one guarded washer command (POWER_ON, POWER_OFF or START) and is a dry run unless `--yes` is given.
- **CLI device-list dump** — `devices --dump-device` and `connect-probe --raw` print the read-only device list; serial and MAC are masked unless `--show-secrets` is used, and tokens are never printed.
- **`connect-probe --energy`** — a read-only call to the Energy API.
- **`connect-settings` CLI command** — a read-only list of every ThinQ Connect profile property with its current value and allowed values.
- **Global `--out <file>` option** — saves the output of any command except `login` to a private file.
- **Push updates (ThinQ Connect)** — PAT login now receives device events over MQTT and re-reads the state on each event. Polling stays as a fallback and slows to a 5 minute safety net while push is healthy; there is no new setting. Not yet tested against the real LG service.
- **Finer air conditioner fan steps (ThinQ Connect)** — the fan slider uses the unit's `windStep` levels (20/40/60/80/100 %) when it reports them.
- **Air conditioner error warning (ThinQ Connect)** — an air conditioner that reports ERROR logs one warning per change, and one message when it recovers.
- **Keep your Matter pairing when switching to PAT login** — an optional `serial-number-mapping` file in the plugin storage folder maps a ThinQ Connect device id to its old account-login device id so the PAT device keeps the same Matter identity. Not yet tested on hardware.
- **`washer-status` and `washer-control` CLI commands (legacy V1 login)** — `washer-status` is a read-only view of the washer snapshot and model controls; `washer-control` sends one guarded command (wake, osp-wake, download-off, download-on) and is a dry run unless `--yes` is given. Used to test whether the legacy API can send a course to the washer. Not used by the plugin runtime; no behavior change.
- **`washer-control` vtCtrl sends (legacy V1 login)** — new `--send vt-course`, `vt-start`, `vt-pause`, `vt-power-on`, `vt-resume` and `vt-power-off` use the LG app's own `vtCtrl` command, with `--rinse`, `--soil`, `--variant` and `--allow-interrupt` (vt-power-off only) options. Same safety rules as before: dry run unless `--yes`, state guards, and `vt-start` and `vt-resume` also need `--allow-start`. After a send it polls the status like the app and prints a verdict. Used to test whether the legacy API can send a course to the washer; not used by the plugin runtime; no behavior change.

### Changed

- **PAT devices run in server mode** — with PAT login, washers and air conditioners are now standalone Matter nodes, each paired on its own, like the account login. They get new device IDs: remove the old PAT devices from your controller and pair them again.
- **Real LG serial number for V1 devices** — V1 (account and token login) washers and air conditioners now use the real LG serial number (`manufacture.serialNo`) as the Matter serial, falling back to the device id. Devices already paired keep their stored serial.
- **ThinQ Connect log messages renamed** — the internal "V2" naming is now "ThinQ Connect" in log output (`ThinQ V2` is now `ThinQ Connect`); no behavior change.
- **Washer registration failure no longer stops start-up** — a ThinQ Connect washer that fails to register is logged and skipped instead of stopping the start-up.

### Fixed

- **Washer state read as empty** — the ThinQ Connect state response is an array; it is now read correctly instead of being treated as empty.
- **Fahrenheit air conditioners (ThinQ Connect)** — units that report Fahrenheit now get correct limits, rounding and unit on temperature writes. Not tested on hardware.
- **Air conditioner and washer on/off stuck (ThinQ Connect)** — turning a PAT air conditioner or washer on or off from Matter could hang, so Apple Home showed OFF a few seconds after turning it on and later taps did nothing. The on/off and Start/Stop commands no longer wait on their own state update. Not yet tested on a real Apple Home.

<a href="https://www.buymeacoffee.com/rinnvspktr" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="41" width="174"></a>

---

## [0.1.1-rc03] - 2026-10-20

### Changed

- **Washer Start/Pause/Stop wired directly to OperationalState** — Pause sends LG's PAUSE control (`WMStop`), Stop sends LG's POWEROFF control (`WMOff`).
- **BREAKING: washer Stop now sends POWEROFF (`WMOff`)** — Matterbridge Stop previously sent LG's PAUSE control (`WMStop`); it now powers the washer off, so automations relying on Stop to pause must use Pause instead.
- **Washer Resume not supported** — LG has no resume control; via Matter, Pause sends PAUSE only when the washer is Running.
- **BREAKING: "Allow Remote Start/Stop (Washer)" settings removed** — the `allowRemoteStart` and `allowRemoteStop` options are gone; old keys are cleaned from existing configs automatically.

### Removed

- **Washer `RemoteStartStopSwitch` child endpoint removed** — the extra Start/Stop switch is gone. The washer is its own Matter node, so it just disappears; if a controller (Apple/Google Home) keeps a stale tile, remove the washer and add it again.

### Fixed

- **Start from Google Home / Matter apps** — Start now actually sends the command to LG instead of only updating the displayed state.
- **ThinQ keep-alive failure logging** — a failed AC keep-alive now logs a single line including LG's resultCode instead of two debug lines; no retry or back-off was added.

<a href="https://www.buymeacoffee.com/rinnvspktr" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="41" width="174"></a>

---

## [0.1.1-rc02] - 2026-10-19

### Added

- **Washer wash-program config selection** — users can choose which washer courses are exposed via plugin config, with the course list trimmed to the selected programs (PR #4).
- **Device-ignore checkbox** — a per-device config checkbox to exclude a device from the plugin (PR #4).

### Changed

- **AC onOffPlugInUnit experiment documented** — docs now record the negative result of the AC onOffPlugInUnit experiment.

### Fixed

- **Washer RemoteStartStopSwitch visibility** — the switch is now hidden when remote start and remote stop are both off.

<a href="https://www.buymeacoffee.com/rinnvspktr" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="41" width="174"></a>

---

## [0.1.1-rc01] - 2026-09-25

### Added

- **Washer remote Start/Stop switch** — an opt-in child on/off switch endpoint on the washer, the only Apple-Home-visible control surface for Start/Stop since the native LaundryWasher device type renders no UI in Apple Home; ON sends a real Start command built from the device's own model-declared default course, OFF reuses the existing Stop path, and switch state syncs from real washer running status on every poll tick. Gated by `allowRemoteStart` (new) and `allowRemoteStop` (existing), both off by default (PR #3).

### Changed

- **BREAKING: webOS TV config section removed** — the never-built webOS placeholder (config UI section, schema property, config model type) has been removed entirely; any existing config with a `webos` property will have it dropped, since Apple Home does not support Matter TV/video-player device types at all, and LG's own native AirPlay 2/HomeKit integration on webOS TVs already covers this (PR #3).

<a href="https://www.buymeacoffee.com/rinnvspktr" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="41" width="174"></a>

---

## [0.1.0-rc13] - 2026-09-24

### Added

- **Per-device `deviceType` field** — a new read-only field, auto-detected from LG's own device type code, is now shown per device in the config UI; not user-editable (PR #19).
- **Automatic `deviceType` population at startup** — the plugin now actually writes `deviceType` into the saved config for every discovered device at startup (new devices get an entry created, existing entries get backfilled); previously the schema claimed this was "Auto-populated on discovery" but nothing implemented it (PR #19).
- **Per-device product identity override** — product identity (name/id shown in Apple Home) moves from a single global, AC-only override to a per-device override with type-specific defaults: AC uses 32768/"LG Air Conditioner", washer uses 32769/"LG Washer" (the washer never had a real product identity wired up before this) (PR #19).

### Changed

- **Config UI now scoped by device type** — each device's settings only show what's relevant to its actual type: `Capabilities` and `AC Filter Control` now only appear for AC devices (`AC Filter Control` additionally requires `Supports Filter Monitoring` to be on), and `Washer Control` only appears for washer devices (PR #19).
- **`ThinQ Devices` list moved below credentials** — the device list now renders after the credential fields (password/refresh token) in the config UI instead of before them, for better visual flow (PR #19).
- **Vendor identity stays global** — vendor identity (name/id) remains a single global setting, since it applies to one Matterbridge install (PR #19).

**Upgrade note:** existing users who had customized the old shared `matterOverrideSettings.matterProductName`/`matterProductId` will see those fields disappear from the config UI on upgrade — there is no migration, this was an accepted, explicit decision — and will need to re-set a product name/ID per device if they want that customization again.

<a href="https://www.buymeacoffee.com/rinnvspktr" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="41" width="174"></a>

---

## [0.1.0-rc12] - 2026-09-24

### Changed

- **AC and washer now pair as standalone Matter nodes** — both device endpoints are hardcoded to `server` mode, so each pairs to Apple Home as its own node with its own pairing code instead of being bridged; not user-configurable, no schema/config option (PR #18). This is experimental: whether `server` mode actually produces a per-device Apple Home power tile for the AC is unconfirmed, since properly testing it requires a real Matter Device Attestation Certificate — self-signed dev certs show "not certified" in Apple Home and may not unlock the full UI.
- **PowerTopology now uses NodeTopology** — the AC's energy-monitoring `PowerTopology` cluster switched from the `TreeTopology` feature to `NodeTopology`, matching the endpoint no longer being shared with a bridge (PR #18).
- **AC scene buttons removed** — the custom quick-access buttons that created a separate `genericSwitch` child Matter endpoint next to the AC have been removed entirely, following the same no-extra-devices-on-the-AC policy as the earlier removal of the Jet/Quiet/Energy-Save/Air-Clean/LED auxiliary toggles (PR #18).

<a href="https://www.buymeacoffee.com/rinnvspktr" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="41" width="174"></a>

---

## [0.1.0-rc11] - 2026-09-23

### Changed

- **Removed AC auxiliary toggle child devices** — Jet, Quiet, Energy Save, Air Clean, and LED no longer create separate child switch/light devices attached to the AC in Apple Home; this is a deliberate feature removal, with no replacement control surface, so users who had these enabled will see the corresponding entities disappear from Apple Home after upgrading (PR #17).

### Refactored

- **Removed dead `supportsDry` capability flag** — the field used to gate whether Dry opMode reported Matter SystemMode.Dry vs Cool, but that branch was already removed in the rc10 cleanup, leaving the capability field, config field, and schema toggle as inert plumbing; all three are now removed (PR #16).

<a href="https://www.buymeacoffee.com/rinnvspktr" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="41" width="174"></a>

---

## [0.1.0-rc10] - 2026-09-23

### Added

- **LG ThinQ Washer support (v1, read-only)** — reports power, run state, and remaining time, registering as Matterbridge's LaundryWasher device type; note that Apple Home does not display the appliance device type at all, a confirmed Matterbridge/Apple platform limitation rather than a bug in this plugin, so the washer is usable today via Home Assistant, SmartThings, or other Matter controllers (PR #13).
- **Opt-in washer Stop command** — `washerControl.allowRemoteStop` (default off) lets Apple Home send a real stop/cancel command to the physical washer (PR #13).
- **AC filter life monitoring** — opt-in via `supportsFilterMonitoring` (default off), exposed as HepaFilterMonitoring; live-verified against a real device with an exact match to the official LG app (PR #15).
- **Opt-in AC filter reset command** — `acFilterControl.allowFilterReset` (default off) sends a real filter-counter reset command after you've replaced/cleaned the filter; this command has not been live-tested yet, so enable only when you are ready to verify it yourself (PR #15).

### Fixed

- **AC mode dropdown showing unsupported values** — Dry and Fan-only opModes now report as Cool instead of SystemMode values Apple Home silently dropped, so the mode dropdown only ever shows what Apple can actually display (Off/Heat/Cool/Auto) (PR #14).

<a href="https://www.buymeacoffee.com/rinnvspktr" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="41" width="174"></a>

---

## [0.1.0-rc09] - 2026-09-20

### Changed

- **AC is now a bridged device** — the AC registers as a normal bridged device and the hardcoded standalone "server" mode was removed, because on iOS 27 the Apple Home Energy tab (whole-home total and per-device detail) only worked in bridged mode. Note for users: remove the old standalone AC from Apple Home and pair through Matterbridge's bridge.
- **Energy measurement on the AC endpoint** — when `supportsEnergyMonitoring` is on, the electrical measurement now always lives on the AC endpoint itself (room air conditioner + power source + electrical sensor device types, with PowerTopology and ElectricalPowerMeasurement); the separate EnergyMonitor child endpoint and the `energyMonitoringPlacement` setting were removed.

### Fixed

- **Power shown while AC is off** — power now reads 0 W when the AC is off; LG reports a floor of about 50 in that state, which was wrongly shown as real consumption.

<a href="https://www.buymeacoffee.com/rinnvspktr" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="41" width="174"></a>

---

## [0.1.0-rc08] - 2026-09-19

### Changed

- **Power reading scale** — `airState.energy.onCurrent` is now read as raw watts (no division by 100), so reported power values are about 100 times larger than before (a running 1 hp AC shows about 900 to 1000 W); the Matter value is still written in milliwatts (PR #11).

### Fixed

- **AC flipping On/Off in Apple Home** — LG MQTT pushes are partial and state sync treated them as full snapshots, so a missing power field read as off; state sync now writes a Matter attribute only when its source property is present in the update (PR #11).

<a href="https://www.buymeacoffee.com/rinnvspktr" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="41" width="174"></a>

---

## [0.1.0-rc07] - 2026-09-19

### Added

- **energyMonitoringPlacement** — experimental per-device setting (`'child'` default, or `'endpoint'`) to host the electrical power measurement on the AC endpoint itself; opt-in, and the AC is not turned into an outlet (PR #10).
- **`energy` CLI command** — live power-reading diagnostics with `--device`, `--samples`, `--interval` and `--keep-alive` options.

### Fixed

- **EnergyMonitor child endpoint** — added the PowerTopology cluster required by the electricalSensor device type, and `activePower` now starts at 0 instead of null. This changes the shape of the child, so Apple Home may need the AC removed and added again.

<a href="https://www.buymeacoffee.com/rinnvspktr" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="41" width="174"></a>

---

## [0.1.0-rc06] - 2026-09-19

### Added

- **overrideMatterConfiguration** — configurable Matter Basic-Information identity (vendor name/id, product name/id) for the AC device, plus an optional per-device `productName` override (PR #9).

### Fixed

- **ElectricalPowerMeasurement attribute bug** — corrected the attribute name from `power` to `activePower` and fixed the missing watts-to-milliwatts unit conversion.
- **EISDIR unhandled rejection on plugin load** — moved the MQTT certificate directory out from inside node-persist's scanned storage directory into a sibling `mqtt-certs/` directory, avoiding the crash on load.

<a href="https://www.buymeacoffee.com/rinnvspktr" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="41" width="174"></a>

---

## [0.1.0-rc05] - 2026-09-19

### Fixed

- **ThinQ token-expiry detection** — treat LG resultCode `0102` as token-expired alongside HTTP 401, resolving AC on/off command failures caused by expired tokens not being refreshed (PR #8).

<a href="https://www.buymeacoffee.com/rinnvspktr" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="41" width="174"></a>

---

## [0.1.0-rc04] - 2026-09-19

### Added

- **AC swing/vane control** — expose vertical/horizontal vane swing mode as a Matter control, gated per-device by capability flag.
- **AC humidity and air-quality sensors** — surface humidity and air-quality (AQI, PM2.5, PM10) readings as Matter sensors for supporting devices.
- **AC energy consumption monitoring** — report instantaneous power consumption for devices that expose it.
- **AC custom scene buttons** — optional quick-access scene buttons that switch the AC to a saved operation-mode combo with one tap.
- **AC Jet/Quiet/Energy-save/Air-clean/LED toggles** — per-device capability-gated toggles for jet mode, quiet mode, energy-save mode, air-clean mode, and LED/display light control.

<a href="https://www.buymeacoffee.com/rinnvspktr" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="41" width="174"></a>

---

## [0.1.0-rc03] - 2026-09-18

### Added

- **AC keep-alive heartbeat** — periodic heartbeat alongside the existing polling loop keeps ThinQ AirConditioner connections alive between state refreshes, reducing stale/dropped device sessions (PR #6).

### Changed

- **Test coverage** — closed a coverage gap to keep CI at the required 75% threshold.

<a href="https://www.buymeacoffee.com/rinnvspktr" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="41" width="174"></a>

---

## [0.1.0-rc02] - 2026-09-16

### Added

- **ThinQ2 MQTT push support** — subscribes to ThinQ2 MQTT push notifications for near-real-time device state updates, with full test coverage.
- **Devices CLI command** — new CLI command to list all ThinQ devices discovered on the account.
- **Lifecycle debug tracing** — debug-level tracing across the ThinQ AirConditioner runtime lifecycle for easier troubleshooting.

### Changed

- **Matterbridge dependency bump** — updated the required Matterbridge version.

<a href="https://www.buymeacoffee.com/rinnvspktr" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="41" width="174"></a>

---

## [0.1.0-rc01] - 2026-09-14

### Added

- **Plugin bootstrap** — initial Matterbridge dynamic platform lifecycle skeleton for LG ThinQ + webOS TV integration.
- **ThinQ CLI login helper** — command-line authentication flow with session persistence for LG ThinQ accounts.
- **ThinQ AirConditioner command wiring** — device discovery, registration, and command dispatch for ThinQ AirConditioner devices.
- **Per-device AC capability flags** — configurable capability detection per AirConditioner device to gate supported features.
- **GitHub Actions workflow templates** — CI workflow scaffolding for automated builds and checks.

### Changed

- **AirConditioner state synchronization** — polling loop applies ThinQ device snapshots to registered Matterbridge endpoints, respecting per-device capabilities.

<a href="https://www.buymeacoffee.com/rinnvspktr" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="41" width="174"></a>

---
