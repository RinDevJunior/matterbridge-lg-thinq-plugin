import * as dgram from 'node:dgram';
import { Socket } from 'node:net';

import type { LgSoundbarDeviceConfig } from '../../model/LgThinqPluginPlatformConfig.js';
import { LG_SOUNDBAR_PORT, type LgSoundbarLogger } from './lgSoundbarProtocol.js';

const MDNS_MULTICAST_ADDRESS = '224.0.0.251';
const MDNS_MULTICAST_PORT = 5353;
const CAST_SERVICE_NAME = '_googlecast._tcp.local';
const DNS_TYPE_PTR = 12;
const DNS_CLASS_IN = 1;
const QR_BIT = 0x8000;

export interface LgSoundbarDiscoveryOptions {
	controlPort?: number;
	mdnsTimeoutMs?: number;
	probeTimeoutMs?: number;
}

export interface LgSoundbarDiscoveryCandidate {
	readonly host: string;
}

function isMdnsResponse(msg: Buffer): boolean {
	if (msg.length < 12) {
		return false;
	}
	const id = msg.readUInt16BE(0);
	const flags = msg.readUInt16BE(2);
	const qr = (flags & QR_BIT) >> 15;
	return id === 0 && qr === 1;
}

/** RFC 1035 §4.1.4 pointer-compression-aware DNS name decoder, modeled on matterbridge's own `decodeDnsName`. */
function decodeDnsNameAt(msg: Buffer, offset: number): { name: string; newOffset: number } {
	const labels: string[] = [];
	let jumped = false;
	let originalOffset = offset;
	let iterations = 0;

	while (true) {
		if (iterations++ > 1000) {
			throw new Error('Too many iterations while decoding DNS name.');
		}
		if (offset >= msg.length) {
			throw new Error('Offset exceeds buffer length while decoding DNS name.');
		}
		const len = msg.readUInt8(offset);
		if (len === 0) {
			offset++;
			break;
		}
		if ((len & 0xc0) === 0xc0) {
			if (offset + 1 >= msg.length) {
				throw new Error('Incomplete pointer encountered while decoding DNS name.');
			}
			const pointer = ((len & 0x3f) << 8) | msg.readUInt8(offset + 1);
			if (!jumped) {
				originalOffset = offset + 2;
			}
			offset = pointer;
			jumped = true;
			continue;
		}
		offset++;
		if (offset + len > msg.length) {
			throw new Error('Label length exceeds buffer bounds while decoding DNS name.');
		}
		labels.push(msg.toString('utf8', offset, offset + len));
		offset += len;
	}

	return { name: labels.join('.'), newOffset: jumped ? originalOffset : offset };
}

function encodeDnsName(name: string): Buffer {
	const buffers: Buffer[] = [];
	for (const label of name.split('.')) {
		const labelBuf = Buffer.from(label, 'utf8');
		const lenBuf = Buffer.alloc(1);
		lenBuf.writeUInt8(labelBuf.length, 0);
		buffers.push(lenBuf, labelBuf);
	}
	return Buffer.concat([...buffers, Buffer.from([0])]);
}

function encodeCastBrowseQuery(): Buffer {
	const header = Buffer.alloc(12);
	header.writeUInt16BE(0, 0);
	header.writeUInt16BE(0, 2);
	header.writeUInt16BE(1, 4);
	header.writeUInt16BE(0, 6);
	header.writeUInt16BE(0, 8);
	header.writeUInt16BE(0, 10);

	const qname = encodeDnsName(CAST_SERVICE_NAME);
	const qtypeClass = Buffer.alloc(4);
	qtypeClass.writeUInt16BE(DNS_TYPE_PTR, 0);
	qtypeClass.writeUInt16BE(DNS_CLASS_IN, 2);

	return Buffer.concat([header, qname, qtypeClass]);
}

/** Decodes only the header's `anCount` and each answer record's owner name — never the RDATA contents. */
function findAnswerMatchingCastService(msg: Buffer): boolean {
	if (msg.length < 12) {
		return false;
	}
	const anCount = msg.readUInt16BE(6);
	let offset = 12;

	try {
		for (let i = 0; i < anCount; i++) {
			const { name, newOffset } = decodeDnsNameAt(msg, offset);
			offset = newOffset;
			// type(2) + class(2) + ttl(4) + rdlength(2)
			if (offset + 10 > msg.length) {
				return false;
			}
			const rdlength = msg.readUInt16BE(offset + 8);
			offset += 10;
			if (name === CAST_SERVICE_NAME) {
				return true;
			}
			offset += rdlength;
		}
	} catch {
		return false;
	}
	return false;
}

/** mDNS browse for `_googlecast._tcp.local`, best-effort, never throws; resolves to [] on any failure. */
async function browseMdnsCandidates(logger: LgSoundbarLogger, timeoutMs: number): Promise<Set<string>> {
	const candidates = new Set<string>();

	return new Promise<Set<string>>((resolve) => {
		let socket: dgram.Socket | undefined;
		let timer: NodeJS.Timeout | undefined;

		const finish = (): void => {
			if (timer) {
				clearTimeout(timer);
			}
			socket?.close();
			resolve(candidates);
		};

		try {
			socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
			socket.on('error', (error: Error) => {
				logger.warn(`LG Soundbar discovery: mDNS socket error: ${error.message}`);
				finish();
			});
			socket.on('message', (msg: Buffer, rinfo: dgram.RemoteInfo) => {
				if (isMdnsResponse(msg) && findAnswerMatchingCastService(msg)) {
					candidates.add(rinfo.address);
				}
			});
			socket.bind(MDNS_MULTICAST_PORT, () => {
				try {
					socket?.addMembership(MDNS_MULTICAST_ADDRESS);
					socket?.setMulticastTTL(255);
					const query = encodeCastBrowseQuery();
					socket?.send(query, 0, query.length, MDNS_MULTICAST_PORT, MDNS_MULTICAST_ADDRESS);
				} catch (error) {
					logger.warn(
						`LG Soundbar discovery: mDNS setup failed: ${error instanceof Error ? error.message : String(error)}`,
					);
					finish();
				}
			});
			timer = setTimeout(finish, timeoutMs);
		} catch (error) {
			logger.warn(`LG Soundbar discovery: mDNS bind failed: ${error instanceof Error ? error.message : String(error)}`);
			resolve(candidates);
		}
	});
}

function probeTcpPort(host: string, port: number, timeoutMs: number): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		const socket = new Socket();
		const finish = (result: boolean): void => {
			socket.destroy();
			resolve(result);
		};
		socket.setTimeout(timeoutMs);
		socket.once('connect', () => finish(true));
		socket.once('timeout', () => finish(false));
		socket.once('error', () => finish(false));
		socket.connect(port, host);
	});
}

/** Best-effort mDNS browse + TCP-port probe; never throws/rejects. */
export async function discoverLgSoundbars(
	logger: LgSoundbarLogger,
	options: LgSoundbarDiscoveryOptions = {},
): Promise<LgSoundbarDiscoveryCandidate[]> {
	const controlPort = options.controlPort ?? LG_SOUNDBAR_PORT;
	const mdnsTimeoutMs = options.mdnsTimeoutMs ?? 4000;
	const probeTimeoutMs = options.probeTimeoutMs ?? 1500;

	try {
		const mdnsCandidates = await browseMdnsCandidates(logger, mdnsTimeoutMs);
		if (mdnsCandidates.size === 0) {
			return [];
		}
		const probeResults = await Promise.allSettled(
			[...mdnsCandidates].map(async (host) => ({
				host,
				reachable: await probeTcpPort(host, controlPort, probeTimeoutMs),
			})),
		);
		return probeResults
			.filter((result): result is PromiseFulfilledResult<{ host: string; reachable: boolean }> => {
				return result.status === 'fulfilled' && result.value.reachable;
			})
			.map((result) => ({ host: result.value.host }));
	} catch (error) {
		logger.warn(`LG Soundbar discovery: failed: ${error instanceof Error ? error.message : String(error)}`);
		return [];
	}
}

/**
 * Fills in a blank `host` on a single config entry when discovery finds exactly one candidate; every config
 * that already has a host is returned untouched. Never throws/rejects; never performs network I/O when every
 * config already has a non-empty host.
 */
export async function resolveLgSoundbarDeviceConfigs(
	configs: readonly LgSoundbarDeviceConfig[],
	logger: LgSoundbarLogger,
	discover: (
		logger: LgSoundbarLogger,
		options?: LgSoundbarDiscoveryOptions,
	) => Promise<LgSoundbarDiscoveryCandidate[]> = discoverLgSoundbars,
): Promise<LgSoundbarDeviceConfig[]> {
	const hasHost = (config: LgSoundbarDeviceConfig): boolean =>
		typeof config.host === 'string' && config.host.trim().length > 0;
	const hostless = configs.filter((config) => !hasHost(config));

	if (hostless.length === 0) {
		return [...configs];
	}

	try {
		const candidates = await discover(logger);

		if (hostless.length === 1 && candidates.length === 1) {
			const resolvedHost = candidates[0].host;
			return configs.map((config) => (hasHost(config) ? config : { ...config, host: resolvedHost }));
		}

		for (const config of hostless) {
			logger.warn(
				`LG Soundbar ${config.id}: auto-discovery did not resolve a unique host (${candidates.length} candidate(s), ${hostless.length} host-less device(s) configured); skipping.`,
			);
		}
		return configs.filter((config) => hasHost(config));
	} catch (error) {
		logger.warn(
			`LG Soundbar discovery: failed to resolve configs: ${error instanceof Error ? error.message : String(error)}`,
		);
		return configs.filter((config) => hasHost(config));
	}
}
