const b = '\x1b[1m'; // bold
const c = '\x1b[36m'; // cyan
const y = '\x1b[33m'; // yellow
const g = '\x1b[32m'; // green
const d = '\x1b[2m'; // dim
const r = '\x1b[0m'; // reset

const NAME_WIDTH = 12;

function row(name: string, args: string, desc: string): string {
	const paddedName = name.padEnd(NAME_WIDTH);
	const paddedArgs = args.padEnd(40);
	return `  ${g}${paddedName}${r}${d}${paddedArgs}${r}${desc}`;
}

export const HELP_TEXT = `
${b}Usage:${r}
  npm run cli -- --command ${c}<command>${r} [options]

${b}Options:${r}
  ${y}--type${r}         account|token (default: account)
  ${y}--country${r}      Country code (default: US)
  ${y}--language${r}     Language code (default: en-US)
  ${y}--help${r}         Show this help message
  ${y}--debug${r}        Enable debug logging

${b}Devices options:${r}
  ${y}--dump-snapshot${r} Device id; prints its full raw ThinQ snapshot JSON instead of the device list
  ${y}--probe-filter${r}  Device id; sends a filterMngStateCtrl Get probe and prints the raw response JSON

${b}Energy options:${r}
  ${y}--device${r}       Device id (default: first AC device)
  ${y}--samples${r}      Number of snapshots to fetch (default: 1)
  ${y}--interval${r}     Seconds between samples (default: 5)
  ${y}--keep-alive${r}   Send the plugin's keep-alive first, wait 2s, then sample

${b}Commands:${r}
${row('login', '', 'Authenticate with LG ThinQ')}
${row('devices', '', 'List all discovered ThinQ devices (requires a prior login)')}
${row('energy', '[energy options]', 'Print raw AC power/energy snapshot fields (requires a prior login)')}
${row('help', '', 'Show this help message')}

${b}Examples:${r}
  npm run cli -- ${y}--help${r}
  npm run cli -- --command ${g}login${r}
  npm run cli -- --command ${g}login${r} --type account --country US --language en-US
  npm run cli -- --command ${g}login${r} --type token
  npm run cli -- --command ${g}devices${r}
  npm run cli -- --command ${g}devices${r} --dump-snapshot <deviceId>
  npm run cli -- --command ${g}devices${r} --probe-filter <deviceId>
  npm run cli -- --command ${g}energy${r}
  npm run cli -- --command ${g}energy${r} --samples 5 --interval 10 --keep-alive
`;
