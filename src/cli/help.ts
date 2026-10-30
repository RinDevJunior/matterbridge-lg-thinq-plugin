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

${b}Connect-settings options:${r}
  ${y}--device-id${r}    Device id to read (default: every device visible to the token)
  ${y}--brief${r}        Print the settings summary only (omit the raw profile/state JSON)

${b}Connect-control options:${r}
  ${y}--device-id${r}    Washer device id (required)
  ${y}--send${r}         POWER_ON|POWER_OFF|START (STOP is refused)
  ${y}--yes${r}          Really send the command (default is a dry run)
  ${y}--wait${r}         Seconds before the after-state read (default: 3)

${b}Washer-status options:${r}
  ${y}--device${r}       Device id (default: first washer)
  ${y}--model${r}        Also print the model's control templates and course options

${b}Washer-control options:${r}
  ${y}--device${r}       Device id (default: first washer)
  ${y}--send${r}         wake|osp-wake|download-off|download-on|vt-course|vt-start|vt-pause|vt-power-on|vt-resume|vt-power-off (dry run unless --yes)
                   Note: vt-power-on does not wake a washer in POWEROFF (LG answers 0111); use osp-wake to switch an off washer on
  ${y}--yes${r}          Really send (refused unless the washer state allows it)
  ${y}--allow-start${r}  Also required for download-on, vt-start and vt-resume (they may start a cycle)
  ${y}--allow-interrupt${r} Required for vt-power-off unless the washer is INITIAL, END or ERROR (abandons a cycle)
  ${y}--wait${r}         Extra seconds when nothing changed after polling (default: 3, 0 skips)
  ${y}--course${r}       Course id from the model (default: model's default course)
  ${y}--spin${r} / ${y}--temp${r} Value or shorthand (800, COLD); must be listed by the course
  ${y}--rinse${r} / ${y}--soil${r} Value or shorthand; vt-course only
  ${y}--no-course${r}   vt-course only: send the option cells with NO course cell (unproven shape; needs one of --soil/--rinse/--spin/--temp)
  ${y}--variant${r}      A|B body shape for the vt-* sends (default: A)
  ${y}--signature${r}    ioBroker-style WMDownload body (download-* only)
  ${y}--endpoint${r}     control|control-sync (default: control-sync)

${b}Commands:${r}
${row('login', '', 'Authenticate with LG ThinQ (pat = ThinQ Connect Personal Access Token, validated read-only, saved to .cli-pat-session.json)')}
${row('devices', '', 'List all discovered ThinQ devices (requires a prior login)')}
${row('energy', '[energy options]', 'Print raw AC power/energy snapshot fields (requires a prior login)')}
${row('connect-probe', '[connect-probe options]', 'Read-only ThinQ Connect API probe: device profile + state summary (requires a prior PAT login)')}
${row('connect-settings', '[connect-settings options]', 'Read-only ThinQ Connect settings: every profile property with current value, access, allowed values (requires a prior PAT login)')}
${row('connect-control', '[connect-control options]', 'Send ONE guarded control command (POWER_ON|POWER_OFF|START) via ThinQ Connect; dry run unless --yes (requires a prior PAT login)')}
${row('washer-status', '[washer-status options]', 'Read-only washer snapshot fields; --model adds control templates and course options (requires a prior login)')}
${row('washer-control', '[washer-control options]', 'Send ONE guarded washer command (wake|osp-wake|download-off|download-on|vt-course|vt-start|vt-pause|vt-power-on|vt-resume|vt-power-off) via the legacy API; dry run unless --yes (requires a prior login)')}
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
  npm run cli -- --command ${g}connect-settings${r}
  npm run cli -- --command ${g}connect-settings${r} --device-id <deviceId>
  npm run cli -- --command ${g}connect-settings${r} --device-id <deviceId> --brief
  npm run cli -- --command ${g}connect-settings${r} --out workspace/out/settings.txt
  npm run cli -- --command ${g}connect-control${r} --device-id <deviceId> --send POWER_ON
  npm run cli -- --command ${g}connect-control${r} --device-id <deviceId> --send START --yes
  npm run cli -- --command ${g}connect-control${r} --device-id <deviceId> --send POWER_OFF
  npm run cli -- --command ${g}connect-probe${r} --device-id <deviceId> --raw --out workspace/out/probe.txt
  npm run cli -- --command ${g}washer-status${r}
  npm run cli -- --command ${g}washer-status${r} --model
  npm run cli -- --command ${g}washer-control${r} --send wake
  npm run cli -- --command ${g}washer-control${r} --send download-off --signature
  npm run cli -- --command ${g}washer-control${r} --send download-off --signature --spin 1200 --temp COLD --yes
  npm run cli -- --command ${g}washer-control${r} --send vt-course --course NORMAL
  npm run cli -- --command ${g}washer-control${r} --send vt-course --course NORMAL --yes
  npm run cli -- --command ${g}washer-control${r} --send vt-start --allow-start
  npm run cli -- --command ${g}washer-control${r} --send vt-resume --allow-start
  npm run cli -- --command ${g}washer-control${r} --send vt-power-off --allow-interrupt
  npm run cli -- --command ${g}washer-control${r} --send vt-course --no-course --rinse RINSE_3
`;
