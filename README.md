<h1 align="center">Matterbridge LG ThinQ Plugin</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/matterbridge-lg-thinq-plugin">
    <img src="https://img.shields.io/npm/v/matterbridge-lg-thinq-plugin/latest.svg" alt="npm version" />
  </a>
  <a href="https://www.npmjs.com/package/matterbridge-lg-thinq-plugin?activeTab=versions">
    <img src="https://img.shields.io/npm/v/matterbridge-lg-thinq-plugin/dev.svg" alt="npm dev version" />
  </a>
  <a href="https://www.typescriptlang.org/">
    <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" alt="typescript" />
  </a>
  <a href="https://nodejs.org/api/esm.html">
    <img src="https://img.shields.io/badge/ESM-Node.js-339933?logo=node.js&logoColor=white" alt="esm" />
  </a>
  <a href="https://www.npmjs.com/package/matterbridge-lg-thinq-plugin">
    <img src="https://img.shields.io/npm/dt/matterbridge-lg-thinq-plugin.svg" alt="npm downloads" />
  </a>
  <a href="https://github.com/RinDevJunior/matterbridge-lg-thinq-plugin/actions/workflows/publish.yml">
    <img src="https://github.com/RinDevJunior/matterbridge-lg-thinq-plugin/actions/workflows/publish.yml/badge.svg" alt="nodejs ci" />
  </a>
  <a href="https://github.com/RinDevJunior/matterbridge-lg-thinq-plugin/actions/workflows/codeql.yml">
    <img src="https://github.com/RinDevJunior/matterbridge-lg-thinq-plugin/actions/workflows/codeql.yml/badge.svg" alt="codeql" />
  </a>
  <a href="https://codecov.io/gh/RinDevJunior/matterbridge-lg-thinq-plugin">
    <img src="https://codecov.io/gh/RinDevJunior/matterbridge-lg-thinq-plugin/branch/main/graph/badge.svg" alt="Codecov" />
  </a>
  <a href="https://www.npmjs.com/package/matterbridge">
    <img src="https://img.shields.io/badge/powered%20by-matterbridge-blue" alt="powered by Matterbridge" />
  </a>
  <a href="https://github.com/prettier/prettier">
    <img src="https://img.shields.io/badge/styled_with-Prettier-f8bc45.svg?logo=prettier" alt="styled with prettier" />
  </a>
  <a href="https://github.com/eslint/eslint">
    <img src="https://img.shields.io/badge/linted_with-ES_Lint-4B32C3.svg?logo=eslint" alt="linted with eslint" />
  </a>
  <a href="https://www.npmjs.com/package/node-ansi-logger">
    <img src="https://img.shields.io/badge/powered%20by-node--ansi--logger-blue" alt="powered by node-ansi-logger" />
  </a>
</p>

---

**Matterbridge LG ThinQ Plugin** is a dynamic platform plugin for [Matterbridge](https://www.npmjs.com/package/matterbridge) that exposes LG ThinQ cloud-connected appliances to Apple Home and other Matter-compatible apps.

> ⭐ If you find this project useful, please consider starring the repository on GitHub:  
> [https://github.com/RinDevJunior/matterbridge-lg-thinq-plugin](https://github.com/RinDevJunior/matterbridge-lg-thinq-plugin)

---

### ⚠️ Important Notes

Requires matterbridge@3.11.0

- Each device (air conditioner or washer) pairs to Apple Home as its **own standalone Matter node** (`server` mode) with its own pairing code — not bridged, not user-configurable.
- Authenticate with your ThinQ account (username/password) or a pre-issued refresh token. This is the supported login (reverse-engineered account API). The Personal Access Token (PAT) login is under development and not supported yet.
- Per-device settings in the config UI are automatically scoped to that device's actual type (AC vs. washer) — the plugin detects and writes this in for you at startup.

---

### 🧊 Supported Devices

**Air Conditioner** — full control:

- Power, mode, temperature, fan speed, swing/vane control
- Humidity and air-quality (AQI/PM2.5/PM10) sensors
- Live energy/power consumption monitoring
- Filter life monitoring, plus an opt-in filter-reset command

**Washer** — read-only status, plus real Start, Pause and Stop from the washer's own controls in Google Home / Apple Home (resolved from the device's own model data and your selected wash course). On models without the LG app's `vtCtrl` command, Stop turns the washer off and Resume is not supported by LG.

**Washer (account or token login, models with `uniProtocol` and `vtCtrl`)** — controlled through the LG app's own `vtCtrl` command: On, Off, Start, Pause, Resume and Stop. On uses the washer's own wake-up command from its model data (the vtCtrl power-on does not work on a washer that is off) and is refused when the model has none; the washer then goes from off to ready. Other washer models keep the older behaviour described above.

- The wash course comes from `Selected Wash Course` in the plugin settings (restart the plugin after changing it) or from Home, which lists the washer's own courses and sends a change to the washer.
- Wash steps: Matter reports one of 8 steps (Detecting to Cooling) while the washer is washing; it is empty when off, paused, finished or in error.
- Cycle finished: a one-time message is sent when a cycle ends, with the measured run and paused time. It is not sent at start-up or after a restart.
- Home controls (course, temperature, spin, rinses): there is no setting to turn them off; the only way back is an older version. Not yet tested on a real washer through Home.
- Start takes two taps. With the washer on and loaded and its door closed, the first tap selects your course and Home shows a message (the tap is reported as failed on purpose) asking you to hold the Remote Control button on the washer for 3 seconds. After that, tap Start again to begin the wash. If Remote Control is already on, the washer runs the course shown on its panel.
- Pause and Resume work any time during a wash. Start while paused resumes.
- Stop and Off are refused during a wash unless `Allow cancelling a running wash` is on. When it is on, the washer is paused first and then powered off, which abandons the cycle (water may stay in the drum and the door may stay locked). Stop or Off while a wash is running (with `Allow cancelling a running wash` on) pauses, confirms, then powers off, which can take 30 seconds or more, so a Home app may show "no response" although the washer did what was asked; Start and the course tap take up to about 15 seconds.
- Every command re-reads the washer first and is checked against its real state. If the washer does not confirm a Start or Resume, further Start and Resume taps are refused for 2 minutes; check the washer first. The lock-out is kept in memory and is cleared by a plugin restart; a timed-out send may still complete later, and the lock-out covers Start and Resume only.

---

### 🚧 Personal Access Token Login (Under development)

> **Under development: not supported yet. Do not use it for production.** Use the account login (username/password or refresh token) instead. Everything below describes work in progress and may change or not work.

A Personal Access Token (PAT) login for LG's official ThinQ Connect API is being built. Username/password and token logins are unchanged.

1. Create a PAT at [https://connect-pat.lgthinq.com](https://connect-pat.lgthinq.com).
2. In the plugin config, set **Login Type** to `pat`, paste the token into **Personal Access Token**, and set **Country** to your account country (e.g. `US`).

What it does today:

- Washers and air conditioners are registered as separate Matter devices (`server` mode). Each one is paired on its own with its own pairing code, exactly like the account login.
- Washer: appears as a Matter washer that Google Home can turn on and off. On is any state except `POWER_OFF`. Off and on commands are refused while the washer is running or paused, or when its state is unknown.
- Washer Start and Stop: Start is sent only from `INITIAL` with Remote Start not off, Stop only while running or paused. Anything else is refused and the tile falls back to the real state. The plugin never powers the washer on for a Start.
- Air conditioner: power, target temperature, fan speed, swing, room temperature, humidity (on units that report it) and read-only filter life. Home shows Cool and Off. The fan slider uses the finer `windStep` levels (20/40/60/80/100 %) where the unit reports them. Units that report Fahrenheit use their own unit for limits and writes (not tested on hardware). A unit that reports ERROR logs one warning.
- After a command, the state is re-read about 3 s later.
- State arrives by push (ThinQ Connect events over MQTT) when available, and each event triggers a state re-read. Push is on by default and has no setting. Polling stays as a fallback every `refreshIntervalSeconds` (minimum 15 s) and, while push is healthy, as a 5 minute safety net.
- Push keeps one anonymous client id in `thinq-connect-client-id.json` in the plugin storage folder so LG sees the same client after a restart. Keys and certificates are kept in memory only and are never logged or written to disk.
- Push log lines (info): `ThinQ Connect push: starting for N device(s).`, `connected to the MQTT broker.`, `subscribed to events for N of M device(s).`, `healthy, safety poll in use.`, and `unavailable (...), polling stays on; retry in N s.` With `debug` on you also see each event as `event DEVICE_STATUS for <id> (changed: ...)`.
- Each washer and air conditioner is added automatically to the ThinQ Devices list in the plugin settings. `Ignore`, product name and product ID work for PAT devices too; restart the plugin after changing them.
- The air conditioner's room temperature is also reported as a Matter temperature sensor.
- Because PAT devices now run in server mode, they get new device IDs. Remove any previously paired PAT washer or air conditioner from your controller and pair it again with its new pairing code.

#### Keep your Matter pairing when you switch from account login to PAT

If you already paired devices while using the account login (V1), you can keep them paired by telling the plugin which old device ID belongs to each PAT device. Without this, the devices get new identities and must be paired again.

- The file is `serial-number-mapping` in the plugin storage folder: `<matterbridge plugin storage>/matterbridge-lg-thinq-plugin/serial-number-mapping`. The plugin creates it automatically at start-up with comments only, and never overwrites an existing file.
- One device per line: `<ThinQ Connect id> = <account login id>`. For example, `5d0fcc73...b02d3 = ee7980cc-7dba-13a4-af04-dc69cc57b6a8` (a washer). Lines starting with `#` and blank lines are ignored. Accepted separators are `=`, `->`, `=>`, `:`, `,` or spaces.
- Steps:
  1. While still on the account login, start the plugin once so the file is created.
  2. Get the ThinQ Connect ids (`npm run cli -- connect-probe`, or the first PAT start log) and the old ids (`npm run cli -- devices`).
  3. Write one line per device: `connect id = old id`.
  4. Do not rename the device in the LG ThinQ app, and keep your product name and `overrideMatterConfiguration` settings as they were.
  5. Set **Login Type** to `pat` and restart the plugin.
  6. Check the log for `loaded N device mapping(s) from serial-number-mapping.` and confirm the controller still shows the device.
- Caveats:
  - The device name (the LG alias) must stay identical. It decides which stored Matter node is reused.
  - A device without a line gets a new identity, as before.
  - A bad line or an unknown id is reported as a warning in the log and skipped.
  - This is based on reading Matterbridge's code and is not yet tested on hardware. Keep a copy of the `matterstorage` folder in `~/.matterbridge` before you switch.

Limits:

- Air conditioner: no heat mode, energy monitoring, filter reset, swing angle, dust values, display light, timers.
- Washer Start and Stop work through ThinQ Connect only when the washer is idle (`INITIAL`) with Remote Start on; START has not been tested on hardware yet. Pause and resume are not available.
- Push needs a token with the event permission. If LG's event subscription cap is reached (error 1312) that device stays on polling. Push is not yet tested against the real LG service; if it fails, polling keeps everything working.

---

### 🚧 Project Status

- **Under active development**
- Requires **`matterbridge@3.11.0`**

---

### 📦 Prerequisites

- A working installation of [Matterbridge](https://github.com/Luligu/matterbridge)
- An LG ThinQ account with at least one supported air conditioner or washer

**Developers:** see [README_CLI.md](./docs/README_CLI.md) for CLI diagnostics (device listing, snapshot dumps, filter/energy probes).

---

### 💬 Need Help?

🛠️ **Reporting an Issue**  
Open an issue on GitHub with as much detail as you can (Matterbridge version, plugin version, relevant log lines):  
👉 [https://github.com/RinDevJunior/matterbridge-lg-thinq-plugin/issues](https://github.com/RinDevJunior/matterbridge-lg-thinq-plugin/issues)

---

### 🧱 Built With

This plugin is built on top of the official dynamic platform example:  
🔗 [matterbridge-example-dynamic-platform](https://github.com/Luligu/matterbridge-example-dynamic-platform)
