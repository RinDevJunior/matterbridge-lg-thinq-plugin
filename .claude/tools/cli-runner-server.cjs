'use strict';

// MCP stdio server — runs this project's compiled CLI (dist/cli.js) and
// captures its output for investigation. Node built-ins only; no npm deps.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CLI_PATH = path.resolve(__dirname, '..', '..', 'dist', 'cli.js');

const TIMEOUT_MS = 30000;

// Commands allowed through this tool. `login` is intentionally excluded —
// the user handles authentication manually via `npm run cli -- --command login`.
const ALLOWED_COMMANDS = [
  'devices',
  'status',
  'start',
  'stop',
  'pause',
  'resume',
  'ping',
  'clean-mode',
  'room-info',
  'map-info',
  'legacy-map-info',
  'legacy-map-info-v2',
  'b01-pose-info',
  'scenes',
  'network-info',
  'custom',
  'connect-probe',
  'connect-control',
];

const CONNECT_SEND_VALUES = ['POWER_ON', 'POWER_OFF', 'START'];
const MAX_WAIT_SECONDS = 20;

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

// Pure: validates input and builds the CLI argv. No fs, no spawn.
function buildCliArgs({ command, duid, local, debug, detail, method, params, send: sendFlag, deviceId, sendValue, yes, raw, wait }) {
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
  const isConnect = isConnectControl || command === 'connect-probe';
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

  const args = ['--command', command];
  if (duid) args.push('--duid', String(duid));
  if (local) args.push('--local', 'true');
  if (debug) args.push('--debug', 'true');
  if (detail) args.push('--detail', 'true');
  if (method) args.push('--method', String(method));
  if (params) args.push('--params', String(params));
  if (sendFlag && !isConnectControl) args.push('--send', 'true');
  if (deviceId && isConnect) args.push('--device-id', String(deviceId));
  if (raw === true && command === 'connect-probe') args.push('--raw', 'true');
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
      "Run this project's compiled CLI (dist/cli.js) and capture stdout/stderr for investigation. Does not support the 'login' command — handle authentication manually first. ThinQ Connect: 'connect-probe' is read-only. 'connect-control' (washer POWER_ON|POWER_OFF|START) is a DRY RUN by default; it only sends a REAL command to the appliance when 'yes' is true, which requires the user's explicit approval for that specific send. Never set 'yes' on your own initiative.",
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          enum: ALLOWED_COMMANDS,
          description: 'CLI command to run (login is not supported here — run it manually)',
        },
        duid: { type: 'string', description: 'Device UID (required by most device commands)' },
        local: { type: 'boolean', description: 'Send via local network (TCP) instead of MQTT' },
        debug: { type: 'boolean', description: 'Enable debug logging' },
        detail: { type: 'boolean', description: 'Show extra detail (only meaningful for "scenes")' },
        method: { type: 'string', description: 'MQTT method name (required by "custom")' },
        params: { type: 'string', description: 'JSON string of params (used by "custom")' },
        send: { type: 'boolean', description: 'Fire-and-forget send (used by "custom")' },
        deviceId: { type: 'string', description: 'Connect device id (--device-id), used by connect-probe/connect-control' },
        sendValue: { type: 'string', enum: CONNECT_SEND_VALUES, description: 'connect-control value to send; dry run unless yes=true' },
        yes: { type: 'boolean', description: 'connect-control only: REALLY send to the appliance. Default false = dry run. Requires the user\'s explicit approval.' },
        raw: { type: 'boolean', description: 'connect-probe only: also print raw JSON' },
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
