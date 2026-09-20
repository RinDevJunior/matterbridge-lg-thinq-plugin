# Changelog

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
