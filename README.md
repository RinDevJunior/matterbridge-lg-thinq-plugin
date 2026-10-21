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

Requires matterbridge@3.10.10

- Each device (air conditioner or washer) pairs to Apple Home as its **own standalone Matter node** (`server` mode) with its own pairing code — not bridged, not user-configurable.
- Authenticate with your ThinQ account (username/password) or a pre-issued refresh token.
- Per-device settings in the config UI are automatically scoped to that device's actual type (AC vs. washer) — the plugin detects and writes this in for you at startup.

---

### 🧊 Supported Devices

**Air Conditioner** — full control:

- Power, mode, temperature, fan speed, swing/vane control
- Humidity and air-quality (AQI/PM2.5/PM10) sensors
- Live energy/power consumption monitoring
- Filter life monitoring, plus an opt-in filter-reset command

**Washer** — read-only status, plus real Start, Pause and Stop from the washer's own controls in Google Home / Apple Home (resolved from the device's own model data and your selected wash course). Stop turns the washer off; Resume is not supported by LG.

---

### 🔑 Personal Access Token Login

Besides username/password and refresh token, you can sign in with a Personal Access Token (PAT) for LG's official ThinQ Connect API. Username/password and token logins are unchanged.

1. Create a PAT at [https://connect-pat.lgthinq.com](https://connect-pat.lgthinq.com).
2. In the plugin config, set **Login Type** to `pat`, paste the token into **Personal Access Token**, and set **Country** to your account country (e.g. `US`).

What it does today:

- Washers and air conditioners are registered as separate Matter devices (`server` mode). Each one is paired on its own with its own pairing code, exactly like the account login.
- Washer: appears as a Matter washer that Google Home can turn on and off. On is any state except `POWER_OFF`. Off and on commands are refused while the washer is running or paused, or when its state is unknown.
- Air conditioner: power, target temperature (Celsius), fan speed, swing, room temperature, humidity (on units that report it) and read-only filter life. Home shows Cool and Off.
- After a command, the state is re-read about 3 s later.
- State is polled every `refreshIntervalSeconds` (the Refresh Interval setting). Values below 15 s are raised to 15 s.
- Each washer and air conditioner is added automatically to the ThinQ Devices list in the plugin settings. `Ignore`, product name and product ID work for PAT devices too; restart the plugin after changing them.
- The air conditioner's room temperature is also reported as a Matter temperature sensor.
- Because PAT devices now run in server mode, they get new device IDs. Remove any previously paired PAT washer or air conditioner from your controller and pair it again with its new pairing code.

Limits:

- Air conditioner: no heat mode, energy monitoring, filter reset, swing angle, dust values, display light, timers or wind steps.
- No washer start, stop or pause (the CLI `connect-control` can send START, but the plugin does not).
- No push updates, only polling.

---

### 🚧 Project Status

- **Under active development**
- Requires **`matterbridge@3.10.10`**

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
