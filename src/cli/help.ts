const b = '\x1b[1m'; // bold
const c = '\x1b[36m'; // cyan
const y = '\x1b[33m'; // yellow
const g = '\x1b[32m'; // green
const d = '\x1b[2m'; // dim
const r = '\x1b[0m'; // reset

const NAME_WIDTH = 14;

function row(name: string, args: string, desc: string): string {
	const paddedName = name.padEnd(NAME_WIDTH);
	const paddedArgs = args.padEnd(40);
	return `  ${g}${paddedName}${r}${d}${paddedArgs}${r}${desc}`;
}

export const HELP_TEXT = `
${b}Usage:${r}
  npm run cli -- --command ${c}<command>${r} [options]

${b}Options:${r}
  ${y}--type${r}         account|token|pat (default: account)
  ${y}--country${r}      Country code (default: US)
  ${y}--language${r}     Language code (default: en-US)
  ${y}--help${r}         Show this help message
  ${y}--debug${r}        Enable debug logging
  ${y}--out${r}          File path; also save the command output (colours removed, serial/MAC masked, hdnts links redacted) to it. Not for login. Needs a file path value.

${b}Devices options:${r}
  ${y}--dump-snapshot${r} Device id; prints its full raw ThinQ snapshot JSON instead of the device list
  ${y}--probe-filter${r}  Device id; sends a filterMngStateCtrl Get probe and prints the raw response JSON
  ${y}--dump-device${r}   Device id; prints its raw device-list entry (serial/MAC masked)
  ${y}--show-secrets${r}  Print serialNo/MAC unmasked in --dump-device / connect-probe --raw; tokens are never printed. Put it last or before another --flag

${b}Energy options:${r}
  ${y}--device${r}       Device id (default: first AC device)
  ${y}--samples${r}      Number of snapshots to fetch (default: 1)
  ${y}--interval${r}     Seconds between samples (default: 5)
  ${y}--keep-alive${r}   Send the plugin's keep-alive first, wait 2s, then sample

${b}Connect-probe options:${r}
  ${y}--device-id${r}    Device id to probe (default: every device visible to the token)
  ${y}--raw${r}          Also print the raw GET /devices entry and the raw profile/state JSON
  ${y}--show-secrets${r} Print serialNo/MAC unmasked with --raw; tokens are never printed. Put it last or before another --flag
  ${y}--energy${r}       Read-only: also call the Energy API profile and usage for each probed device. Put it last or before another --flag
  ${y}--energy-period${r} DAILY|MONTHLY (default: DAILY)
  ${y}--energy-start${r} Usage start: YYYYMMDD for DAILY, YYYYMM for MONTHLY (default: last 7 days / last 3 months)
  ${y}--energy-end${r}   Usage end, same format as --energy-start

${b}Connect-control options:${r}
  ${y}--device-id${r}    Washer device id (required)
  ${y}--send${r}         POWER_ON|POWER_OFF|START (STOP is refused)
  ${y}--yes${r}          Really send the command (default is a dry run)
  ${y}--wait${r}         Seconds before the after-state read (default: 3)

${b}Commands:${r}
${row('login', '', 'Authenticate with LG ThinQ (pat = ThinQ Connect Personal Access Token, validated read-only, saved to .cli-pat-session.json)')}
${row('devices', '', 'List all discovered ThinQ devices (requires a prior login)')}
${row('energy', '[energy options]', 'Print raw AC power/energy snapshot fields (requires a prior login)')}
${row('connect-probe', '[connect-probe options]', 'Read-only ThinQ Connect API probe: device profile + state summary (requires a prior PAT login)')}
${row('connect-control', '[connect-control options]', 'Send ONE guarded control command (POWER_ON|POWER_OFF|START) via ThinQ Connect; dry run unless --yes (requires a prior PAT login)')}
${row('help', '', 'Show this help message')}

${b}Examples:${r}
  npm run cli -- ${y}--help${r}
  npm run cli -- --command ${g}login${r}
  npm run cli -- --command ${g}login${r} --type account --country US --language en-US
  npm run cli -- --command ${g}login${r} --type token
  npm run cli -- --command ${g}login${r} --type pat --country US
  npm run cli -- --command ${g}devices${r}
  npm run cli -- --command ${g}devices${r} --dump-snapshot <deviceId>
  npm run cli -- --command ${g}devices${r} --probe-filter <deviceId>
  npm run cli -- --command ${g}devices${r} --dump-device <deviceId>
  npm run cli -- --command ${g}devices${r} --dump-device <deviceId> --show-secrets
  npm run cli -- --command ${g}energy${r}
  npm run cli -- --command ${g}energy${r} --samples 5 --interval 10 --keep-alive
  npm run cli -- --command ${g}connect-probe${r}
  npm run cli -- --command ${g}connect-probe${r} --device-id <deviceId>
  npm run cli -- --command ${g}connect-probe${r} --device-id <deviceId> --raw
  npm run cli -- --command ${g}connect-probe${r} --device-id <deviceId> --energy
  npm run cli -- --command ${g}connect-control${r} --device-id <deviceId> --send POWER_ON
  npm run cli -- --command ${g}connect-control${r} --device-id <deviceId> --send START --yes
  npm run cli -- --command ${g}connect-control${r} --device-id <deviceId> --send POWER_OFF
  npm run cli -- --command ${g}connect-probe${r} --device-id <deviceId> --raw --out workspace/out/probe.txt
`;
