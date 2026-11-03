import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LgSoundbarDeviceConfig } from '../../model/LgThinqPluginPlatformConfig.js';
import type { LgSoundbarLogger } from './lgSoundbarProtocol.js';
import { type LgSoundbar, LgSoundbarService } from './lgSoundbarService.js';

const clientHarness = vi.hoisted(() => ({
	instances: [] as {
		host: string;
		port: number | undefined;
		getState: ReturnType<typeof vi.fn>;
		setPower: ReturnType<typeof vi.fn>;
		setVolume: ReturnType<typeof vi.fn>;
		getSoundMode: ReturnType<typeof vi.fn>;
		getSoundModeInfo: ReturnType<typeof vi.fn>;
		setSoundMode: ReturnType<typeof vi.fn>;
	}[],
}));

vi.mock('./lgSoundbarClient.js', () => ({
	LgSoundbarClient: vi.fn(function (options: { host: string; port?: number }) {
		const instance = {
			host: options.host,
			port: options.port,
			getState: vi.fn(),
			setPower: vi.fn(),
			setVolume: vi.fn(),
			getSoundMode: vi.fn(),
			getSoundModeInfo: vi.fn(),
			setSoundMode: vi.fn(),
		};
		clientHarness.instances.push(instance);
		return instance;
	}),
}));

function createMockSoundbarLogger(): LgSoundbarLogger {
	return { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function clientFor(deviceId: string, soundbars: readonly LgSoundbar[]) {
	const index = soundbars.findIndex((s) => s.deviceId === deviceId);
	return clientHarness.instances[index];
}

/** Clients are created lazily on first use; this triggers creation so the mock can be configured beforehand. */
function warmClient(service: InstanceType<typeof LgSoundbarService>, soundbar: LgSoundbar): void {
	void service.getState(soundbar);
}

describe('LgSoundbarService', () => {
	let logger: LgSoundbarLogger;
	let service: InstanceType<typeof LgSoundbarService>;

	beforeEach(() => {
		vi.clearAllMocks();
		clientHarness.instances.length = 0;
		logger = createMockSoundbarLogger();
		service = new LgSoundbarService(logger);
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
	});

	describe('discoverSoundbars', () => {
		it('should map config entries 1:1 with no network I/O', () => {
			// Arrange
			const configs: LgSoundbarDeviceConfig[] = [
				{ id: 'sb1', host: '10.0.0.5' },
				{ id: 'sb2', name: 'Living Room', host: '10.0.0.6', port: 9999 },
			];

			// Act
			const soundbars = service.discoverSoundbars(configs);

			// Assert
			expect(soundbars).toEqual([
				{ deviceId: 'sb1', name: 'LG Soundbar 10.0.0.5', host: '10.0.0.5', port: 9741 },
				{ deviceId: 'sb2', name: 'Living Room', host: '10.0.0.6', port: 9999 },
			]);
			expect(clientHarness.instances).toHaveLength(0);
		});

		it('should default port to 9741 when omitted', () => {
			// Arrange
			const configs: LgSoundbarDeviceConfig[] = [{ id: 'sb1', host: '10.0.0.5' }];

			// Act
			const [soundbar] = service.discoverSoundbars(configs);

			// Assert
			expect(soundbar.port).toBe(9741);
		});

		it('should skip a config entry with no host and log a warning, returning only the entries that have a host', () => {
			// Arrange
			const configs: LgSoundbarDeviceConfig[] = [{ id: 'sb1' }, { id: 'sb2', host: '10.0.0.6' }];

			// Act
			const soundbars = service.discoverSoundbars(configs);

			// Assert
			expect(soundbars).toHaveLength(1);
			expect(soundbars[0].deviceId).toBe('sb2');
			expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('sb1'));
		});
	});

	describe('delegation to the cached client', () => {
		it('should reuse the same client instance for a second call with the same deviceId', async () => {
			// Arrange
			const [soundbar] = service.discoverSoundbars([{ id: 'sb1', host: '10.0.0.5' }]);

			// Act
			await service.getState(soundbar);
			await service.setPower(soundbar, true);
			await service.setVolume(soundbar, 10);

			// Assert
			expect(clientHarness.instances).toHaveLength(1);
		});

		it('should delegate getState/setPower/setVolume to the client for the given deviceId', async () => {
			// Arrange
			const [soundbar] = service.discoverSoundbars([{ id: 'sb1', host: '10.0.0.5' }]);
			warmClient(service, soundbar);
			const client = clientFor('sb1', [soundbar]);
			client.getState.mockResolvedValue({ powerOn: true, volume: 5, volumeMin: 0, volumeMax: 10 });

			// Act
			const state = await service.getState(soundbar);
			await service.setPower(soundbar, true);
			await service.setVolume(soundbar, 7);

			// Assert
			expect(state).toEqual({ powerOn: true, volume: 5, volumeMin: 0, volumeMax: 10 });
			expect(client.setPower).toHaveBeenCalledWith(true);
			expect(client.setVolume).toHaveBeenCalledWith(7);
		});

		it('should delegate getSoundMode to the client for the given deviceId', async () => {
			// Arrange
			const [soundbar] = service.discoverSoundbars([{ id: 'sb1', host: '10.0.0.5' }]);
			warmClient(service, soundbar);
			const client = clientFor('sb1', [soundbar]);
			client.getSoundMode.mockResolvedValue(3);

			// Act
			const soundMode = await service.getSoundMode(soundbar);

			// Assert
			expect(soundMode).toBe(3);
		});

		it('should delegate getSoundModeInfo to the client for the given deviceId', async () => {
			// Arrange
			const [soundbar] = service.discoverSoundbars([{ id: 'sb1', host: '10.0.0.5' }]);
			warmClient(service, soundbar);
			const client = clientFor('sb1', [soundbar]);
			client.getSoundModeInfo.mockResolvedValue({ mode: 3, supportedModes: [0, 1, 2] });

			// Act
			const soundModeInfo = await service.getSoundModeInfo(soundbar);

			// Assert
			expect(soundModeInfo).toEqual({ mode: 3, supportedModes: [0, 1, 2] });
		});

		it('should delegate setSoundMode(soundbar, eq) to the client with the given eq value', async () => {
			// Arrange
			const [soundbar] = service.discoverSoundbars([{ id: 'sb1', host: '10.0.0.5' }]);
			warmClient(service, soundbar);
			const client = clientFor('sb1', [soundbar]);

			// Act
			await service.setSoundMode(soundbar, 8);

			// Assert
			expect(client.setSoundMode).toHaveBeenCalledWith(8);
		});

		it('should create independent clients for different deviceIds', async () => {
			// Arrange
			const soundbars = service.discoverSoundbars([
				{ id: 'sb1', host: '10.0.0.5' },
				{ id: 'sb2', host: '10.0.0.6' },
			]);

			// Act
			await service.getState(soundbars[0]);
			await service.getState(soundbars[1]);

			// Assert
			expect(clientHarness.instances).toHaveLength(2);
		});
	});

	describe('startPolling', () => {
		it('should call getState for every soundbar and invoke onUpdate only for the ones that resolved', async () => {
			// Arrange
			vi.useFakeTimers();
			const soundbars = service.discoverSoundbars([
				{ id: 'sb1', host: '10.0.0.5' },
				{ id: 'sb2', host: '10.0.0.6' },
			]);
			warmClient(service, soundbars[0]);
			warmClient(service, soundbars[1]);
			clientFor('sb1', soundbars).getState.mockResolvedValue({
				powerOn: true,
				volume: 1,
				volumeMin: 0,
				volumeMax: 10,
			});
			clientFor('sb1', soundbars).getSoundModeInfo.mockResolvedValue({ mode: 3, supportedModes: undefined });
			clientFor('sb2', soundbars).getState.mockRejectedValue(new Error('unreachable'));
			const onUpdate = vi.fn();

			// Act
			service.startPolling(1000, soundbars, onUpdate);
			await vi.advanceTimersByTimeAsync(1000);

			// Assert
			expect(onUpdate).toHaveBeenCalledTimes(1);
			expect(onUpdate).toHaveBeenCalledWith('sb1', {
				powerOn: true,
				volume: 1,
				volumeMin: 0,
				volumeMax: 10,
				soundMode: 3,
				supportedSoundModes: undefined,
			});
			expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('sb2'));
		});

		it('should skip onUpdate for a soundbar whose getSoundModeInfo rejects while getState resolves, and log a warning mentioning it', async () => {
			// Arrange
			vi.useFakeTimers();
			const soundbars = service.discoverSoundbars([
				{ id: 'sb1', host: '10.0.0.5' },
				{ id: 'sb2', host: '10.0.0.6' },
			]);
			warmClient(service, soundbars[0]);
			warmClient(service, soundbars[1]);
			clientFor('sb1', soundbars).getState.mockResolvedValue({
				powerOn: true,
				volume: 1,
				volumeMin: 0,
				volumeMax: 10,
			});
			clientFor('sb1', soundbars).getSoundModeInfo.mockRejectedValue(new Error('eq unreachable'));
			clientFor('sb2', soundbars).getState.mockResolvedValue({
				powerOn: false,
				volume: 2,
				volumeMin: 0,
				volumeMax: 10,
			});
			clientFor('sb2', soundbars).getSoundModeInfo.mockResolvedValue({ mode: 1, supportedModes: undefined });
			const onUpdate = vi.fn();

			// Act
			service.startPolling(1000, soundbars, onUpdate);
			await vi.advanceTimersByTimeAsync(1000);

			// Assert
			expect(onUpdate).not.toHaveBeenCalledWith('sb1', expect.anything());
			expect(onUpdate).toHaveBeenCalledWith('sb2', {
				powerOn: false,
				volume: 2,
				volumeMin: 0,
				volumeMax: 10,
				soundMode: 1,
				supportedSoundModes: undefined,
			});
			expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('sb1'));
		});

		it('should merge a defined supportedSoundModes into the object passed to onUpdate when the device reports ai_eq_list', async () => {
			// Arrange
			vi.useFakeTimers();
			const soundbars = service.discoverSoundbars([{ id: 'sb1', host: '10.0.0.5' }]);
			warmClient(service, soundbars[0]);
			clientFor('sb1', soundbars).getState.mockResolvedValue({
				powerOn: true,
				volume: 1,
				volumeMin: 0,
				volumeMax: 10,
			});
			clientFor('sb1', soundbars).getSoundModeInfo.mockResolvedValue({ mode: 2, supportedModes: [0, 1, 2] });
			const onUpdate = vi.fn();

			// Act
			service.startPolling(1000, soundbars, onUpdate);
			await vi.advanceTimersByTimeAsync(1000);

			// Assert
			expect(onUpdate).toHaveBeenCalledWith('sb1', {
				powerOn: true,
				volume: 1,
				volumeMin: 0,
				volumeMax: 10,
				soundMode: 2,
				supportedSoundModes: [0, 1, 2],
			});
		});

		it('should not stop the interval or block other soundbars when one rejects', async () => {
			// Arrange
			vi.useFakeTimers();
			const soundbars = service.discoverSoundbars([
				{ id: 'sb1', host: '10.0.0.5' },
				{ id: 'sb2', host: '10.0.0.6' },
			]);
			warmClient(service, soundbars[0]);
			warmClient(service, soundbars[1]);
			clientFor('sb1', soundbars).getState.mockRejectedValue(new Error('boom'));
			clientFor('sb2', soundbars).getState.mockResolvedValue({
				powerOn: false,
				volume: 2,
				volumeMin: 0,
				volumeMax: 10,
			});
			clientFor('sb2', soundbars).getSoundModeInfo.mockResolvedValue({ mode: undefined, supportedModes: undefined });
			const onUpdate = vi.fn();

			// Act
			service.startPolling(1000, soundbars, onUpdate);
			await vi.advanceTimersByTimeAsync(1000);
			await vi.advanceTimersByTimeAsync(1000);

			// Assert
			expect(onUpdate).toHaveBeenCalledTimes(2);
			expect(onUpdate).toHaveBeenCalledWith('sb2', {
				powerOn: false,
				volume: 2,
				volumeMin: 0,
				volumeMax: 10,
				soundMode: undefined,
				supportedSoundModes: undefined,
			});
		});
	});

	describe('stopPolling', () => {
		it('should clear the interval so no further onUpdate calls happen after a later timer advance', async () => {
			// Arrange
			vi.useFakeTimers();
			const soundbars = service.discoverSoundbars([{ id: 'sb1', host: '10.0.0.5' }]);
			warmClient(service, soundbars[0]);
			clientFor('sb1', soundbars).getState.mockResolvedValue({
				powerOn: true,
				volume: 1,
				volumeMin: 0,
				volumeMax: 10,
			});
			clientFor('sb1', soundbars).getSoundModeInfo.mockResolvedValue({ mode: undefined, supportedModes: undefined });
			const onUpdate = vi.fn();
			service.startPolling(1000, soundbars, onUpdate);
			await vi.advanceTimersByTimeAsync(1000);
			expect(onUpdate).toHaveBeenCalledTimes(1);

			// Act
			service.stopPolling();
			await vi.advanceTimersByTimeAsync(5000);

			// Assert
			expect(onUpdate).toHaveBeenCalledTimes(1);
		});
	});
});
