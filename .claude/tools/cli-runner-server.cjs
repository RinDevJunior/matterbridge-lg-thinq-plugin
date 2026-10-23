'use strict';

// MCP stdio server — runs this project's compiled CLI (dist/cli.js) and
// captures its output for investigation. Node built-ins only; no npm deps.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const CLI_PATH = path.join(PROJECT_ROOT, 'dist', 'cli.js');
const WORKSPACE_DIR = path.join(PROJECT_ROOT, 'workspace');

const TIMEOUT_MS = 30000;

// Commands allowed through this tool. `login` is intentionally excluded —
// the user handles authentication manually via `npm run cli -- --command login`.
const ALLOWED_COMMANDS = ['devices', 'energy', 'connect-probe', 'connect-control', 'connect-settings', 'washer-status', 'help'];

const CONNECT_SEND_VALUES = ['POWER_ON', 'POWER_OFF', 'START'];
const MAX_WAIT_SECONDS = 20;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const ENERGY_PERIODS = ['DAILY', 'MONTHLY'];
const ENERGY_DATE_PATTERNS = new Map([
  ['DAILY', /^\d{4}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/],
  ['MONTHLY', /^\d{4}(0[1-9]|1[0-2])$/],
]);
const MAX_SAMPLES = 20;
const MAX_INTERVAL_SECONDS = 60;

// ---------------------------------------------------------------------------
// Transport helpers
// ---------------------------------------------------------------------------

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function sendResult(id, content) {
  send({
    jsonrpc: '2.0',
    id,
    result: {
      content: [{ type: 'text', text: content }],
    },
  });
}

function sendError(id, code, message) {
  send({
    jsonrpc: '2.0',
    id,
    error: { code, message },
  });
}

// ---------------------------------------------------------------------------
// RunCli tool implementation
// ---------------------------------------------------------------------------

const isProvided = (value) => value !== undefined && value !== null;

// The regex alone would accept "--yes"/"--out"; a leading "-" is refused so a value can never read as a flag.
function isDeviceId(value) {
  return typeof value === 'string' && DEVICE_ID_PATTERN.test(value) && !value.startsWith('-');
}

const OUT_ERROR = 'Error: "out" must be a file path inside workspace/ (relative paths resolve from the project root).';
const DEVICE_ID_ERROR = 'Error: device id must be letters, digits, "_" or "-" (max 128 characters).';

function isWithin(root, target) {
  const rel = path.relative(root, target);
  return !path.isAbsolute(rel) && rel.split(path.sep)[0] !== '..';
}

function pathExists(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

// Only paths strictly inside <project>/workspace are allowed; `~` is not expanded.
// Symlinks: the nearest existing ancestor (and the target itself if it exists) must also
// realpath inside the realpath of workspace/, so a symlink cannot redirect the write out.
function resolveOutPath(out) {
  if (typeof out !== 'string' || out.trim().length === 0) {
    return { error: 'Error: "out" must be a non-empty file path inside workspace/.' };
  }
  const resolved = path.resolve(PROJECT_ROOT, out);
  if (resolved === WORKSPACE_DIR || !isWithin(WORKSPACE_DIR, resolved)) {
    return { error: OUT_ERROR };
  }
  try {
    let anchor = path.dirname(resolved);
    while (!pathExists(anchor)) {
      anchor = path.dirname(anchor);
    }
    const realAnchor = fs.realpathSync(anchor);
    if (pathExists(WORKSPACE_DIR)) {
      const realWorkspace = fs.realpathSync(WORKSPACE_DIR);
      if (!isWithin(realWorkspace, realAnchor)) {
        return { error: OUT_ERROR };
      }
      if (pathExists(resolved) && !isWithin(realWorkspace, fs.realpathSync(resolved))) {
        return { error: OUT_ERROR };
      }
    } else if (realAnchor !== fs.realpathSync(PROJECT_ROOT)) {
      // workspace/ is absent (gitignored, e.g. on CI): nothing between the root and the target may be a symlink.
      return { error: OUT_ERROR };
    }
  } catch {
    return { error: OUT_ERROR };
  }
  return { path: resolved };
}

// Validates the connect-probe energy window and returns its flags (empty when none given).
function buildEnergyWindowArgs({ energyPeriod, energyStart, energyEnd }) {
  const period = isProvided(energyPeriod) ? String(energyPeriod).trim().toUpperCase() : 'DAILY';
  if (!ENERGY_PERIODS.includes(period)) {
    return { error: `Error: energyPeriod must be one of ${ENERGY_PERIODS.join(', ')}` };
  }

  const args = [];
  if (isProvided(energyPeriod)) args.push('--energy-period', period);

  const datePattern = ENERGY_DATE_PATTERNS.get(period);
  const dateHint = period === 'DAILY' ? 'YYYYMMDD' : 'YYYYMM';
  for (const [flag, value] of [['energy-start', energyStart], ['energy-end', energyEnd]]) {
    if (!isProvided(value)) continue;
    if (typeof value !== 'string' || !datePattern.test(value)) {
      return { error: `Error: --${flag} must be ${dateHint} for ${period} (got "${value}").` };
    }
    args.push(`--${flag}`, value);
  }
  return { args };
}

// Pure: validates input and builds the CLI argv. No fs, no spawn.
function buildCliArgs(input) {
  const {
    command, debug, deviceId, sendValue, yes, raw, wait, energy, brief, out, showSecrets,
    dumpDevice, dumpSnapshot, probeFilter, device, samples, interval, keepAlive,
    energyPeriod, energyStart, energyEnd, model,
  } = input;

  if (!command) {
    return { error: 'Error: "command" is required.' };
  }

  if (command === 'login') {
    return { error: 'Error: the "login" command is not available through this tool. Run it manually yourself: npm run cli -- --command login' };
  }

  if (!ALLOWED_COMMANDS.includes(command)) {
    return { error: `Error: unknown or disallowed command "${command}". Allowed commands: ${ALLOWED_COMMANDS.join(', ')}` };
  }

  const isConnectControl = command === 'connect-control';
  const isConnect = isConnectControl || command === 'connect-probe' || command === 'connect-settings';
  let normalizedSendValue;
  if (isConnectControl) {
    normalizedSendValue = String(sendValue ?? '').trim().toUpperCase();
    if (!CONNECT_SEND_VALUES.includes(normalizedSendValue)) {
      return { error: 'Error: sendValue must be one of POWER_ON, POWER_OFF, START (STOP is not supported)' };
    }
    if (!deviceId) {
      return { error: 'Error: "deviceId" is required for connect-control.' };
    }
  }
  if (isConnect && isProvided(deviceId) && !isDeviceId(deviceId)) {
    return { error: DEVICE_ID_ERROR };
  }

  const args = ['--command', command];
  if (debug) args.push('--debug', 'true');
  if (isProvided(out)) {
    const resolvedOut = resolveOutPath(out);
    if ('error' in resolvedOut) return { error: resolvedOut.error };
    args.push('--out', resolvedOut.path);
  }

  if (command === 'devices') {
    const deviceFlags = [['dump-device', dumpDevice], ['dump-snapshot', dumpSnapshot], ['probe-filter', probeFilter]];
    for (const [flag, value] of deviceFlags) {
      if (!isProvided(value)) continue;
      if (!isDeviceId(value)) {
        return { error: `Error: --${flag} needs a device id (letters, digits, "_" or "-", max 128 characters).` };
      }
      args.push(`--${flag}`, value);
    }
    if (showSecrets === true && isProvided(dumpDevice)) args.push('--show-secrets', 'true');
  }

  if (command === 'energy') {
    if (isProvided(device)) {
      if (!isDeviceId(device)) {
        return { error: 'Error: --device needs a device id (letters, digits, "_" or "-", max 128 characters).' };
      }
      args.push('--device', device);
    }
    if (isProvided(samples)) {
      if (!Number.isInteger(samples) || samples < 1 || samples > MAX_SAMPLES) {
        return { error: `Error: samples must be an integer from 1 to ${MAX_SAMPLES}.` };
      }
      args.push('--samples', String(samples));
    }
    if (isProvided(interval)) {
      if (!Number.isFinite(interval) || interval < 1 || interval > MAX_INTERVAL_SECONDS) {
        return { error: `Error: interval must be a number of seconds from 1 to ${MAX_INTERVAL_SECONDS}.` };
      }
      args.push('--interval', String(interval));
    }
    if (keepAlive === true) args.push('--keep-alive', 'true');
  }

  // washer-status is READ-ONLY. washer-control is deliberately NOT allow-listed here (it can send to a real washer).
  if (command === 'washer-status') {
    if (isProvided(device)) {
      if (!isDeviceId(device)) {
        return { error: 'Error: --device needs a device id (letters, digits, "_" or "-", max 128 characters).' };
      }
      args.push('--device', device);
    }
    if (model === true) args.push('--model', 'true');
  }

  if (deviceId && isConnect) args.push('--device-id', String(deviceId));
  if (raw === true && command === 'connect-probe') args.push('--raw', 'true');
  if (showSecrets === true && raw === true && command === 'connect-probe') args.push('--show-secrets', 'true');
  if (energy === true && command === 'connect-probe') args.push('--energy', 'true');
  if (command === 'connect-probe') {
    const energyWindow = buildEnergyWindowArgs({ energyPeriod, energyStart, energyEnd });
    if ('error' in energyWindow) return { error: energyWindow.error };
    args.push(...energyWindow.args);
  }
  if (brief === true && command === 'connect-settings') args.push('--brief', 'true');
  if (isConnectControl) {
    args.push('--send', normalizedSendValue);
    if (typeof wait === 'number' && Number.isFinite(wait) && wait >= 0) {
      args.push('--wait', String(Math.min(wait, MAX_WAIT_SECONDS)));
    }
    // Strict boolean: only a real `true` ever reaches the CLI as a live send.
    if (yes === true) args.push('--yes', 'true');
  }

  return { args };
}

function runCli(input) {
  const built = buildCliArgs(input || {});
  if ('error' in built) {
    return built.error;
  }

  if (!fs.existsSync(CLI_PATH)) {
    return `Error: compiled CLI not found at ${CLI_PATH}. Build the project first: npm run build`;
  }

  const args = built.args;

  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let exitCode = 0;

  try {
    stdout = execFileSync(process.execPath, [CLI_PATH, ...args], {
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
      killSignal: 'SIGKILL',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    stdout = err.stdout ? err.stdout.toString() : '';
    stderr = err.stderr ? err.stderr.toString() : '';
    timedOut = err.signal === 'SIGKILL' || err.signal === 'SIGTERM' || err.killed === true;
    exitCode = typeof err.status === 'number' ? err.status : 1;
  }

  const parts = [];
  if (stdout.trim().length > 0) parts.push(`--- stdout ---\n${stdout.trim()}`);
  if (stderr.trim().length > 0) parts.push(`--- stderr ---\n${stderr.trim()}`);
  if (parts.length === 0) parts.push('(no output)');
  if (timedOut) parts.push(`--- note ---\nProcess timed out after ${TIMEOUT_MS}ms and was killed. Output above is what was captured before the timeout.`);
  else if (exitCode !== 0) parts.push(`--- note ---\nProcess exited with non-zero exit code: ${exitCode}`);

  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOL_DEFINITIONS = [
  {
    name: 'RunCli',
    description:
      "Run this project's compiled CLI (dist/cli.js) and capture stdout/stderr for investigation. Does not support the 'login' command — handle authentication manually first. 'devices' lists ThinQ devices (optional dumpDevice/dumpSnapshot/probeFilter device ids). 'energy' prints V1 AC power/energy snapshots (read-only). 'connect-probe' and 'connect-settings' are read-only ThinQ Connect probes; set 'energy' on connect-probe to also call the read-only Energy API (energyPeriod/energyStart/energyEnd). 'washer-status' is a READ-ONLY legacy (V1 login) washer snapshot (device optional; model=true also prints the model control templates); it never sends anything. 'connect-control' (washer POWER_ON|POWER_OFF|START) is a DRY RUN by default; it only sends a REAL command to the appliance when 'yes' is true, which requires the user's explicit approval for that specific send. Never set 'yes' on your own initiative. 'out' saves the output to a file inside workspace/ only. 'showSecrets' prints the real serial/MAC (devices dumpDevice, connect-probe raw) — use only when the user asks.",
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          enum: ALLOWED_COMMANDS,
          description: 'CLI command to run (login is not supported here — run it manually)',
        },
        debug: { type: 'boolean', description: 'Enable debug logging' },
        out: {
          type: 'string',
          description: 'Also save the output to this file, which must be inside the project workspace/ directory (relative paths resolve from the project root; ~ is not expanded). Not for login.',
        },
        showSecrets: {
          type: 'boolean',
          description: 'Print the REAL serialNo/MAC unmasked. Only with devices+dumpDevice or connect-probe+raw. Tokens are never printed. Use ONLY when the user explicitly asks for the real serial/MAC.',
        },
        deviceId: { type: 'string', description: 'Connect device id (--device-id), used by connect-probe/connect-settings/connect-control' },
        dumpDevice: { type: 'string', description: 'devices only: device id; prints its raw device-list entry (serial/MAC masked unless showSecrets)' },
        dumpSnapshot: { type: 'string', description: 'devices only: device id; prints its full raw ThinQ snapshot JSON' },
        probeFilter: { type: 'string', description: 'devices only: device id; sends a filterMngStateCtrl Get probe and prints the raw response JSON' },
        device: { type: 'string', description: 'energy: device id (default: first AC device); washer-status: device id (default: first washer)' },
        model: { type: 'boolean', description: 'washer-status only: also print the model control templates and course options (read-only)' },
        samples: { type: 'number', description: 'energy only: number of snapshots to fetch, integer 1-20 (default 1)' },
        interval: { type: 'number', description: 'energy only: seconds between samples, 1-60 (default 5)' },
        keepAlive: { type: 'boolean', description: 'energy only: send the plugin keep-alive first, wait 2s, then sample' },
        sendValue: { type: 'string', enum: CONNECT_SEND_VALUES, description: 'connect-control value to send; dry run unless yes=true' },
        yes: { type: 'boolean', description: 'connect-control only: REALLY send to the appliance. Default false = dry run. Requires the user\'s explicit approval.' },
        raw: { type: 'boolean', description: 'connect-probe only: also print raw JSON' },
        energy: { type: 'boolean', description: 'connect-probe only: also call the read-only Energy API (profile + usage)' },
        energyPeriod: { type: 'string', enum: ENERGY_PERIODS, description: 'connect-probe only: energy usage period (default DAILY)' },
        energyStart: { type: 'string', description: 'connect-probe only: usage start, YYYYMMDD for DAILY or YYYYMM for MONTHLY' },
        energyEnd: { type: 'string', description: 'connect-probe only: usage end, same format as energyStart' },
        brief: { type: 'boolean', description: 'connect-settings only: omit the raw profile/state JSON, print the settings summary only' },
        wait: { type: 'number', description: 'connect-control only: seconds before the after-state read, default 3, max 20' },
      },
      required: ['command'],
    },
  },
];

// ---------------------------------------------------------------------------
// Request dispatcher
// ---------------------------------------------------------------------------

function handleRequest(req) {
  const { id, method, params } = req;

  // Notifications (no id) — no response
  if (id === undefined || id === null) {
    return;
  }

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'cli-runner-server', version: '1.0.0' },
        capabilities: { tools: {} },
      },
    });
    return;
  }

  if (method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id,
      result: { tools: TOOL_DEFINITIONS },
    });
    return;
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params || {};
    try {
      let text;
      if (name === 'RunCli') {
        text = runCli(args || {});
      } else {
        sendError(id, -32601, `Unknown tool: ${name}`);
        return;
      }
      sendResult(id, text);
    } catch (err) {
      sendResult(id, `Error: ${err.message}`);
    }
    return;
  }

  sendError(id, -32601, `Method not found: ${method}`);
}

// ---------------------------------------------------------------------------
// Main — read newline-delimited JSON from stdin
// ---------------------------------------------------------------------------

if (require.main === module) {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const req = JSON.parse(trimmed);
      handleRequest(req);
    } catch (_) {
      // Malformed JSON — ignore
    }
  });
}

module.exports = { buildCliArgs, ALLOWED_COMMANDS, TOOL_DEFINITIONS };
