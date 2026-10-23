# ThinQ CLI Login Helper

A standalone command-line tool for authenticating with LG ThinQ, saving your session, and listing discovered devices for use with the Matterbridge LG ThinQ plugin.

## Setup

Build the project first:

```bash
npm run build:local
```

This compiles TypeScript and generates the CLI binary at `dist/cli.js`.

## Usage

Run the CLI with:

```bash
npm run cli -- --command <command> [options]
```

## Commands

| Command            | Options                                                                                                                                                 | Description                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `login`            | `--type`, `--country`, `--language`                                                                                                                     | Authenticate and save session                                                                 |
| `devices`          |                                                                                                                                                         | List all discovered ThinQ devices (requires `login`)                                          |
| `connect-probe`    | `--device-id`, `--raw`, `--energy`                                                                                                                      | Read-only ThinQ Connect probe (requires PAT `login`)                                          |
| `connect-settings` | `--device-id`, `--brief`                                                                                                                                | Read-only ThinQ Connect device settings (requires PAT `login`)                                |
| `connect-control`  | `--device-id`, `--send`, `--yes`, `--wait`                                                                                                              | Send one guarded washer command (requires PAT `login`)                                        |
| `washer-status`    | `--device`, `--model`                                                                                                                                   | Read-only washer snapshot; `--model` adds control templates (requires `login`)                |
| `washer-control`   | `--device`, `--send`, `--yes`, `--allow-start`, `--wait`, `--course`, `--spin`, `--temp`, `--rinse`, `--soil`, `--variant`, `--signature`, `--endpoint` | Send one guarded washer command via the legacy API; dry run unless `--yes` (requires `login`) |
| `help`             |                                                                                                                                                         | Show help message                                                                             |

## Login Command

The `login` command guides you through authentication and saves your credentials to a local session file.

### Options

- `--type`: Authentication method (default: `account`)
  - `account`: Username/password authentication
  - `token`: Refresh token authentication
  - `pat`: ThinQ Connect Personal Access Token (see [PAT Login](#pat-login))
- `--country`: Country code (default: `US`) — must match your LG ThinQ account region
- `--language`: Language code (default: `en-US`)
- `--debug`: Enable debug logging

### Examples

#### Account-based authentication (default):

```bash
npm run cli -- --command login
```

You will be prompted for:

- Username (email)
- Password

#### Account-based authentication with specific region:

```bash
npm run cli -- --command login --type account --country KR --language ko-KR
```

#### Token-based authentication:

```bash
npm run cli -- --command login --type token
```

You will be prompted for:

- Refresh token

### Example Session Output

```
Login successful. Session saved to .cli-session.json
Session Summary:
  Login Type: account
  Country: US
  Language: en-US
  Access Token: ****XXXX
  Refresh Token: ****XXXX
  Expires At: 2026-09-08T23:59:59.000Z
```

Note: All tokens are masked in the output for security.

## Devices Command

The `devices` command lists all ThinQ devices discovered in your account, using the session saved by a prior `login` command.

### Options

- `--dump-device <deviceId>`: print that device's raw device-list entry as JSON (serial/MAC masked)
- `--show-secrets`: with `--dump-device`, print serial/MAC unmasked. Tokens and the PAT are never printed. Put it last or before another `--` flag, because the parser takes the next non-flag token as its value.
- `--debug`: Enable debug logging

### Prerequisites

You must run `--command login` successfully first. If no session file is found, the command prints an error and exits.

### Example

```bash
npm run cli -- --command devices
```

### Example Output

```
Found 2 device(s):

1. Living Room AC
   Device ID:     a1b2c3d4-e5f6-7890-abcd-ef1234567890
   Type:          AC
   Platform Type: thinq2
   Model Name:    RAC-1234
   Online:        true

2. Kitchen Fridge
   Device ID:     b2c3d4e5-f6a7-8901-bcde-f12345678901
   Type:          REFRIGERATOR
   Platform Type: thinq2
   Model Name:    LRF-5678
   Online:        false
```

## PAT Login

Create a Personal Access Token at https://connect-pat.lgthinq.com, then run:

```bash
npm run cli -- --command login --type pat --country US
```

You will be prompted for the Personal Access Token. It is checked with a read-only call, then saved to `.cli-pat-session.json` (gitignored). The token is never printed in full; only a masked form is shown.

## Connect-Probe Command

Read-only. Prints the device profile and a state summary from the ThinQ Connect API. Requires a prior PAT login.

- `--device-id`: probe one device (default: every device visible to the token)
- `--raw`: also print the raw `GET /devices` entry and the raw profile/state JSON. The entry is masked: serial/MAC show only the last 4 characters.
- `--show-secrets`: with `--raw`, print serial/MAC unmasked. Tokens and the PAT are never printed. Put it last or before another `--` flag.
- `--energy`: also call the read-only Energy API (profile, then usage per listed property) for each probed device. Unsupported products (1220, 1221, 1307) are an expected outcome and do not set a failing exit code. Put it last or before another `--` flag.
- `--energy-period`: `DAILY` (default) or `MONTHLY`
- `--energy-start` / `--energy-end`: `YYYYMMDD` for DAILY (max 31 days), `YYYYMM` for MONTHLY (max 12 months). Default: last 7 days / last 3 months.

```bash
npm run cli -- --command connect-probe --device-id <deviceId>
npm run cli -- --command connect-probe --device-id <deviceId> --energy
```

## Connect-Settings Command

Read-only. Prints every device setting from the ThinQ Connect profile, grouped by resource group, with the current value (from the state), access (`r` read, `w` write, `rw`, `fixed` for a fixed value), the allowed values or range, and the unit. Then the raw profile and state JSON. Requires a prior PAT login. Uses only `GET /devices`, `GET /devices/{id}/profile` and `GET /devices/{id}/state`.

- `--device-id`: read one device (default: every device visible to the token)
- `--brief`: print the settings summary only, without the raw profile/state JSON (the AC profile is long)

Washers: ThinQ Connect exposes no washer course (program) selection in any profile checked, so the command prints `courses: no course settings in the ThinQ Connect profile for this model (V1 legacy API has them)`. Course settings exist only in the V1 API, which this command does not use.

```bash
npm run cli -- --command connect-settings
npm run cli -- --command connect-settings --device-id <deviceId> --brief
npm run cli -- --command connect-settings --out workspace/out/settings.txt
```

Washer example (`--brief`):

```
Device: Washer [DEVICE_WASHER] VCDWL_QEUK (5d0fcc73...b02d3)
  settings:
  location MAIN
    [runState]
      currentState  r  = POWER_OFF  (REFRESHING, RUNNING, POWER_OFF, SOAKING, DETECTING, FROZEN_PREVENT_RUNNING, RINSING, DETERGENT_AMOUNT, FROZEN_PREVENT_PAUSE, DRYING, RESERVED, FROZEN_PREVENT_INITIAL, RINSE_HOLD, PREWASH, END, PAUSE, ERROR, STEAM_SOFTENING, SPINNING, DISPENSING, INITIAL, ADD_DRAIN)
    [operation]
      washerOperationMode  w  = -  (write: START, STOP, POWER_OFF, POWER_ON)
    [detergent]
      detergentSetting  fixed  = AUTO
    [remoteControlEnable]
      remoteControlEnabled  r  = false  (false, true)
    [timer]
      remainHour            r   = 0  (0..30 step 1)
      remainMinute          r   = 0  (0..59 step 1)
      totalHour             r   = 1  (0..30 step 1)
      totalMinute           r   = 58  (0..59 step 1)
      relativeHourToStop    rw  = 0  (3..19 step 1)
      relativeMinuteToStop  r   = 0  (0..30 step 1)
    [cycle]
      cycleCount  r  = 15
  courses: no course settings in the ThinQ Connect profile for this model (V1 legacy API has them)
```

AC example (`--brief`, excerpt):

```
Device: Study Room - Air Conditioner [DEVICE_AIR_CONDITIONER] RAC_056905_WW (30ed71f9...b068)
  settings:
    [airConJobMode]
      currentJobMode        rw  = COOL    (FAN, AIR_DRY, COOL, AUTO)
    [operation]
      airConOperationMode   rw  = POWER_OFF  (POWER_ON, POWER_OFF)
    [temperature]
      currentTemperature    r   = 30 C
      targetTemperature     rw  = 27 C    (16..30 step 0.5)
    [temperatureInUnits F]
      targetTemperature     r   = 80 F
      coolTargetTemperature w   = -       (60..86 step 1)
    [airFlow]
      windStrength          rw  = HIGH    (LOW, MID, HIGH, AUTO)
```

## Connect-Control Command

Sends ONE guarded washer command through the ThinQ Connect API. Requires a prior PAT login.

- `--device-id`: washer device id (required)
- `--send`: `POWER_ON`, `POWER_OFF` or `START` (`STOP` is refused)
- `--yes`: really send the command. Without it, the command is a dry run and nothing is sent.
- `--wait`: seconds to wait before reading the state again (default: 3)

The command is refused while the washer is `RUNNING` or `PAUSE`, or if the profile does not list the value as writable. The PAT is never printed.

```bash
npm run cli -- --command connect-control --device-id <deviceId> --send POWER_ON --yes
```

### cli-runner MCP tool

The Claude `cli-runner` tool exposes the commands `devices`, `energy`, `connect-probe`, `connect-settings`, `connect-control`, `washer-status` (read-only; `device`, `model`) and `help` (no `login`, no `washer-control`). Params: `deviceId`, `raw` and `energy` (probe, boolean), `energyPeriod` (DAILY|MONTHLY), `energyStart`/`energyEnd` (YYYYMMDD for DAILY, YYYYMM for MONTHLY; validated before the CLI runs), `brief` (settings, boolean), `dumpDevice`/`dumpSnapshot`/`probeFilter` (devices, device ids), `device`/`samples` (1-20)/`interval` (1-60 s)/`keepAlive` (energy), and for control `sendValue`, `wait` (seconds, default 3, max 20) and `yes`. `yes` must be the boolean `true` to send; anything else is a dry run. `out` saves the output to a file that must resolve inside `workspace/`. `showSecrets` (boolean) prints the real serial/MAC for `dumpDevice` and `connect-probe` with `raw`; use it only when the user asks.

## Washer-Status Command

Read-only. Prints the washer snapshot fields (`washerDryer.*`). `--model` also prints the model's `ControlWifi` templates, the relevant `Config` flags and the default course's spin/temp options. Sends nothing. Requires an account or token `login`.

```bash
npm run cli -- --command washer-status
npm run cli -- --command washer-status --model
npm run cli -- --command washer-status --device <deviceId> --model --out workspace/out/washer-model.txt
```

## Washer-Control Command

Legacy-login (account or token) experiment: tests whether the V1 API can stage a course on the washer with `WMDownload` ("Send to washer"). It sends at most ONE command per run, and only with `--yes`.

- `--send wake|osp-wake|download-off|download-on|vt-course|vt-start|vt-pause|vt-power-on` (required). Dry run unless `--yes`.
- `--allow-start` is also required for `download-on` and `vt-start` (they may start a cycle).
- `--course`, `--spin`, `--temp`, `--signature` apply to `download-*` only; `--course`, `--spin`, `--temp`, `--rinse`, `--soil` also apply to `vt-course`. `--spin`/`--temp`/`--rinse`/`--soil` take a value or a shorthand (`800`, `COLD`) or the full enum name, and must be listed by the course. `--rinse`/`--soil` apply to `vt-course` only.
- `--variant A|B` (default `A`) applies to the `vt-*` sends only: `A` puts the `vtCtrl` data directly in `dataSetList`, `B` wraps it as `dataSetList.vtCtrl`.
- `--wait` (extra seconds when nothing changed after polling, default 3, `0` skips), `--endpoint control|control-sync` (default `control-sync`).
- `vt-*` sends (V1 `vtCtrl` command, the same one the LG app uses): `vt-course` selects a course (INITIAL only, Remote Control must be OFF, and it refuses while Remote Control is ON); `vt-start` starts the staged course (INITIAL, door closed, Remote Control ON, course staged); `vt-pause` pauses a running cycle; `vt-power-on` powers on a POWEROFF washer. No `vt-power-off` or resume. Every vt guard also refuses on a child lock or a washer error. Vt sends poll the status 10 times at 500 ms and print a verdict line.
- The `vt-*` body contains only the course and the options you pass. The LG app also sends the other option cells for the model; if LG answers `0114` or `0110`, that is the first thing to revisit.
- The guard refuses unless the washer state allows the command: `wake`/`osp-wake` only in POWEROFF, POWERFAIL, INITIAL or END; `download-*` only in INITIAL. `download-off` refuses unless Remote Control is exactly `REMOTE_START_OFF` (missing or any other value refuses too); `download-on` needs exactly `REMOTE_START_ON`. Every send also refuses unless the device list reports `online: true` (`online status unknown` when the flag is absent).
- Nothing is retried automatically. Passwords, tokens and session data are never printed; device ids are masked.

### Safe Test Recipe

Prerequisites: `npm run build:local`, `npm run cli -- --command login` done once. Washer powered on, Remote Control OFF, drum empty, door closed, you are next to it.

1. `washer-status --model` (read-only). Save with `--out`.
2. `washer-control --send download-off --signature` (dry run). Check: `Guard: PASS`, body has `downloadCourse: COURSE_TYPE_COURSE`, `downloadSlotNumber: 0`, `categoryNumber: 0`, no `courseDownloadType`.
3. Same, plus the values you want kept: `--spin 1200 --temp COLD` (dry run).
4. The one real command: `washer-control --send download-off --signature --spin 1200 --temp COLD --yes`.
5. Read the result. `0000` plus `wifiSDS` OFF to ON, or changed `initialTimeMinute`/`spin`/`temp`, means it worked. `0111` means the washer did not answer. Other codes are explained in the output.
6. If only `0111`: run the same command once more with `--endpoint control`. If it fails again, stop.

Send back: the full terminal output of steps 1, 4 and the retry (if any), plus a second `washer-status` run about 30 s later.

Result codes: `0000` OK; `0111` RESPONSE_DELAY_DEVICE (LG accepted, washer did not answer in time); others are described in the output as "Unknown LG result code" when not listed.

Safety notes: a dry run is the default; `--yes` is required; the guard refuses unless the state is INITIAL; `download-on` needs `--allow-start`, Remote Control ON, and may start a cycle; `download-*` overwrites the staged app profile with the template defaults unless `--spin`/`--temp`/`--course` are given.

### V1 vtCtrl Test Recipe

Tests whether the LG app's own `vtCtrl` command can stage a course through the legacy API. Only `vt-course` is needed for the first test.

1. Prerequisites: `npm run build:local`, `login` done. Washer ON (display lit, state INITIAL), Remote Control OFF, drum empty, child lock off, no error. You stand next to the washer.
2. `npm run cli -- --command washer-status --model --out workspace/out/vt-before.txt` (read-only). Check `uniProtocol = true`, `vtCtrl` is listed, and the `childLock`/`error` lines are present.
3. Dry run: `npm run cli -- --command washer-control --send vt-course --course NORMAL`. Expect `Guard: PASS`, `DRY RUN`, `ctrlKey: vtCtrl`, `vtData.UNDEFINE = [{cmd: course, value: NORMAL, type: ABSOLUTE}]`, `reqDevType: APP`.
4. First real command: `npm run cli -- --command washer-control --send vt-course --course NORMAL --yes` (endpoint `control-sync`, variant A, one cell). It only selects a course; it cannot start a wash.
5. Reading the result: `0000` = accepted; `0111` = the washer answered late (the LG app counts it as success when the status changes; the output says `LIKELY applied` only when a tracked field changed, which is an inference); other codes = rejected, with the text printed. Look at `Changes`: `course` (and `initialTimeMinute`) changing is the signal. Using a different course than the current one proves it better (try `--course COTTONPLUS`).
6. If `0000`/`0111` and nothing changed: ONE retry with `--variant b`; then ONE retry with `--endpoint control`. Stop after that and send the output back. Never loop.
7. Later steps (only after step 4 works, and only on request): `vt-power-on` while POWEROFF. `vt-start` needs Remote Control pressed for 3 s on the washer (light on), door closed, course staged, and `--yes --allow-start`; it may start the cycle. `vt-pause` pauses a running cycle for the moment.
8. Send back: the full output of steps 2, 4 and any retry, plus a second `washer-status` about 30 s after the send.

Each `vt-*` send also prints `Variant:` and a `Verdict:` line. The `dataSetList` shapes (variant A and B) and the endpoint are inferred from the LG app, not proven.

## Saving Output to a File

Add `--out <file>` to any command (except `login`) to save its output to a file as well as printing it. Share the path instead of pasting the output.

```bash
npm run cli -- --command connect-probe --device-id <deviceId> --raw --out workspace/out/probe.txt
npm run cli -- --command devices --dump-device <deviceId> --out ~/Desktop/device.txt
```

- The file holds the same text as the screen, with ANSI colours removed, a short header (`# command`, `# saved`, `# country` when given, `# show-secrets`) and no tokens or PAT. Serial/MAC masking follows the screen rules (`--show-secrets` applies).
- The only file-only change: `hdnts=` values in signed links are replaced with `[REDACTED]`.
- The file is a copy of the screen output. Treat it like the screen: do not share it publicly.
- Mode `0600` (owner only). An existing file is overwritten. Missing parent folders are created. A leading `~` is expanded.
- `workspace/` is git-ignored, so `workspace/out/...` is a safe default location.
- The file is created before the command runs. A bad path stops the command with `--out: <reason>` and exit code 1.
- If the file cannot be written at the end, the screen output is kept, an error is printed and the exit code is 2 (unless the command already failed).
- `--out` is refused for `login` (it prompts for secrets). The session files `.cli-session.json` and `.cli-pat-session.json` cannot be used as the target.
- `--out` must not be the last token or followed by another `--` flag, because the parser takes the next non-flag token as its value.

## Session File

After successful login, your session is saved to `.cli-session.json` in your working directory:

```json
{
  "loginType": "account",
  "country": "US",
  "language": "en-US",
  "userData": {
    "accessToken": "...",
    "refreshToken": "...",
    "expiresAtEpochSeconds": 1234567890,
    "country": "US",
    "language": "en-US"
  }
}
```

**⚠️ Important:** This file contains authentication credentials. Keep it secure and do NOT commit it to version control (it is in `.gitignore` by default).

## Notes

### Supported Authentication Methods

- **Account (username/password):** Uses LG's standard account login flow
- **Refresh token:** For previously-saved tokens; skips the full login chain

### Browser-Based SSO

Third-party SSO (Google, Apple, Facebook, Amazon) is not yet supported in this CLI tool. If your account uses only these methods, you will need to use the Matterbridge web UI or manually obtain a refresh token.

### Device Control

This CLI supports authentication (`login`) and device discovery/listing (`devices`). Device control is not yet available and is handled by the full Matterbridge runtime instead. The exception is the experimental legacy-login `washer-control` command, which sends one guarded command only when `--yes` is given (see below).

### Credentials Security

- Passwords are **never printed** to the console or stored anywhere (only the token is saved).
- All displayed tokens are automatically masked for security.
- Input credentials are read interactively via the terminal, not from command-line arguments, to avoid exposure in shell history.
