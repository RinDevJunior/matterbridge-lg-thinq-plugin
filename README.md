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

**Washer** — read-only status, plus an opt-in remote Stop/Cancel command (resolved from the device's own model data).

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
