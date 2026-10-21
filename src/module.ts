import Path from 'node:path';

import { MatterbridgeDynamicPlatform, MatterbridgeEndpoint, PlatformConfig, PlatformMatterbridge } from 'matterbridge';
import { AnsiLogger, LogLevel } from 'matterbridge/logger';
import NodePersist from 'node-persist';

import { UNREGISTER_DEVICES_DELAY_MS } from './constants/index.js';
import { isAirConditionerDevice, isWasherDevice } from './core/domain/entities/ThinqDevice.js';
import { ManualProcessNeededError } from './errors/index.js';
import { LgThinqPluginPlatformConfig } from './model/LgThinqPluginPlatformConfig.js';
// Platform layer imports
import { DeviceRegistry } from './platform/deviceRegistry.js';
import { PlatformConfigManager } from './platform/platformConfigManager.js';
import { PlatformState } from './platform/platformState.js';
import { applyThinqFilterStateToAirConditioner } from './platform/thinq/thinqAirConditionerFilterStateSync.js';
import { applyThinqSnapshotToAirConditioner } from './platform/thinq/thinqAirConditionerStateSync.js';
import { reconcileThinqDeviceConfigEntries } from './platform/thinq/thinqDeviceConfigReconciler.js';
import { applyThinqSnapshotToWasher } from './platform/thinq/thinqWasherStateSync.js';
import { resolveThinqGeneration } from './platform/thinqGeneration.js';
import { ThinqServiceContainer } from './services/thinq/serviceContainer.js';
import { ThinqSession } from './services/thinq/session.js';
import { ThinqDeviceUpdateListener } from './services/thinq/thinqDeviceService.js';
import type { ThinqFilterUpdateListener } from './services/thinq/thinqFilterMonitoringService.js';
import { PLUGIN_NAME } from './settings.js';
import { applyThinqConnectAirConditionerState } from './thinqConnect/thinqConnectAirConditionerEndpoint.js';
import { registerThinqConnectAirConditioners } from './thinqConnect/thinqConnectAirConditionerRegistration.js';
import type { ThinqConnectAirConditioner } from './thinqConnect/thinqConnectAirConditionerService.js';
import type { ThinqConnectMatterIdentityOverride } from './thinqConnect/thinqConnectMatterIdentity.js';
import { ThinqConnectServiceContainer } from './thinqConnect/thinqConnectServiceContainer.js';
import { applyThinqConnectWasherState } from './thinqConnect/thinqConnectWasherEndpoint.js';
import { registerThinqConnectWashers } from './thinqConnect/thinqConnectWasherRegistration.js';
import type { ThinqConnectWasher } from './thinqConnect/thinqConnectWasherService.js';

export default function initializePlugin(
	matterbridge: PlatformMatterbridge,
	log: AnsiLogger,
	config: PlatformConfig,
): LgThinqMatterbridgePlatform {
	return new LgThinqMatterbridgePlatform(matterbridge, log, config as LgThinqPluginPlatformConfig);
}

/**
 * LG ThinQ platform for Matterbridge (webOS TV lands in a later phase, see below).
 * Empty lifecycle skeleton (Phase 0) — device discovery/configuration lands in Phase 1 (ThinQ) and Phase 3 (webOS).
 */
export class LgThinqMatterbridgePlatform extends MatterbridgeDynamicPlatform {
	public persist: NodePersist.LocalStorage;

	// Platform layer
	public readonly registry: DeviceRegistry;
	public readonly configManager: PlatformConfigManager;
	public readonly state: PlatformState;

	// ThinQ family services (Phase 1: auth + discovery + polling, AirConditioner only)
	public readonly thinqServices: ThinqServiceContainer;

	// ThinQ Connect (PAT) generation: only defined when loginType is 'pat'
	private readonly thinqConnectServices: ThinqConnectServiceContainer | undefined;
	private thinqConnectWashers: ThinqConnectWasher[] = [];
	private thinqConnectAirConditioners: ThinqConnectAirConditioner[] = [];

	private thinqPollingIntervalMs: number | undefined;
	private readonly thinqDeviceKindById = new Map<string, 'AC' | 'WASHER'>();
	private readonly filterMonitoringDeviceIds: string[] = [];

	constructor(
		matterbridge: PlatformMatterbridge,
		logger: AnsiLogger,
		override config: LgThinqPluginPlatformConfig,
	) {
		super(matterbridge, logger, config);
		logger.logLevel = this.config.advancedFeature.settings.debug ? LogLevel.DEBUG : LogLevel.INFO;

		this.log.info('Initializing platform:', this.config.name);

		// Initialize persistence
		const persistDir = Path.join(this.matterbridge.matterbridgePluginDirectory, PLUGIN_NAME, 'persist');
		this.persist = NodePersist.create({ dir: persistDir });

		// Initialize platform layer
		this.configManager = PlatformConfigManager.create(config, this.log);
		this.registry = new DeviceRegistry();
		this.state = new PlatformState();
		this.thinqServices = new ThinqServiceContainer(
			this.log,
			this.persist,
			this.configManager,
			Path.join(this.matterbridge.matterbridgePluginDirectory, PLUGIN_NAME, 'mqtt-certs'),
		);
		this.thinqConnectServices =
			resolveThinqGeneration(this.configManager.thinqLoginType) === 'connect'
				? new ThinqConnectServiceContainer(this.log, {
						personalAccessToken: this.configManager.thinqPersonalAccessToken ?? '',
						country: this.configManager.country,
						pollIntervalSeconds: this.configManager.thinqRefreshIntervalSeconds,
					})
				: undefined;
	}

	// #region Lifecycle
	public override async onStart(reason?: string): Promise<void> {
		this.log.debug(`onStart: entry (reason=${reason ?? 'none'})`);
		this.log.notice('onStart called with reason:', reason ?? 'none');

		await this.ready;
		await this.clearSelect();
		await this.persist.init();

		if (this.configManager.isClearStorageOnStartupEnabled) {
			this.log.debug('onStart: exit early — clear-storage-on-startup enabled, skipping device startup');
			return;
		}

		if (!this.configManager.validateConfig()) {
			this.log.error('Platform configuration is invalid.');
			this.state.setStartupCompleted(false);
			this.log.debug('onStart: exit — invalid platform configuration');
			return;
		}

		try {
			if (this.thinqConnectServices) {
				await this.startThinqConnectDevices();
			} else {
				await this.startThinqDevices();
			}
		} catch (error) {
			this.log.error(`ThinQ startup failed: ${error instanceof Error ? error.message : String(error)}`);
			this.state.setStartupCompleted(false);
			this.log.debug('onStart: exit — ThinQ startup threw');
			return;
		}

		this.log.notice('onStart finished');
		this.state.setStartupCompleted(true);
		this.log.debug('onStart: exit — startup completed successfully');
	}

	public override async onConfigure(): Promise<void> {
		await super.onConfigure();
		this.log.debug('onConfigure: entry');
		this.log.notice('onConfigure called');

		if (this.configManager.isClearStorageOnStartupEnabled) {
			this.log.warn('Clearing persistence storage as per configuration.');
			await this.persist
				.clear()
				.then(() => this.unregisterAllDevices(UNREGISTER_DEVICES_DELAY_MS))
				.then(() => {
					this.log.notice('Please restart the platform now.');
					this.wssSendRestartRequired();
				})
				.catch((error: unknown) => {
					this.log.error(`Error clearing persistence storage: ${error}`);
				});
			this.log.debug('onConfigure: exit early — clear-storage-on-startup enabled');
			return;
		}

		if (!this.state.isStartupCompleted) {
			this.log.debug('onConfigure: exit early — startup did not complete, skipping polling setup');
			return;
		}

		if (this.thinqConnectServices) {
			this.startThinqConnectPolling();
			return;
		}

		const applyDeviceUpdate: ThinqDeviceUpdateListener = (deviceId, snapshot) => {
			const endpoint = this.registry.getDevice(deviceId) as MatterbridgeEndpoint | undefined;
			if (!endpoint) {
				this.log.debug(`ThinQ device update received for unregistered device ${deviceId}, skipping.`);
				return;
			}

			if (this.thinqDeviceKindById.get(deviceId) === 'WASHER') {
				void applyThinqSnapshotToWasher(endpoint, snapshot, this.log).catch((error: unknown) => {
					this.log.error(
						`Failed to apply ThinQ state update for ${deviceId}: ${error instanceof Error ? error.message : String(error)}`,
					);
				});
				return;
			}

			void applyThinqSnapshotToAirConditioner(
				endpoint,
				snapshot,
				this.configManager.getDeviceCapabilities(deviceId),
				this.log,
			).catch((error: unknown) => {
				this.log.error(
					`Failed to apply ThinQ state update for ${deviceId}: ${error instanceof Error ? error.message : String(error)}`,
				);
			});
		};

		this.thinqPollingIntervalMs = this.configManager.thinqRefreshIntervalSeconds * 1000;
		this.thinqServices.getDeviceService().startPolling(this.thinqPollingIntervalMs, applyDeviceUpdate);
		this.thinqServices.getDeviceService().startKeepAlive();
		void this.thinqServices
			.getMqttListener()
			.start(applyDeviceUpdate)
			.catch((error: unknown) => {
				this.log.error(
					`ThinQ MQTT listener failed to start: ${error instanceof Error ? error.message : String(error)}`,
				);
			});

		if (this.filterMonitoringDeviceIds.length > 0) {
			const applyFilterUpdate: ThinqFilterUpdateListener = (deviceId, filterState) => {
				const endpoint = this.registry.getDevice(deviceId) as MatterbridgeEndpoint | undefined;
				if (!endpoint) {
					this.log.debug(`ThinQ filter update received for unregistered device ${deviceId}, skipping.`);
					return;
				}
				void applyThinqFilterStateToAirConditioner(endpoint, filterState, this.log).catch((error: unknown) => {
					this.log.error(
						`Failed to apply ThinQ filter state update for ${deviceId}: ${error instanceof Error ? error.message : String(error)}`,
					);
				});
			};
			const filterMonitoringIntervalMs = this.configManager.thinqFilterMonitoringIntervalSeconds * 1000;
			this.thinqServices
				.getFilterMonitoringService()
				.startPolling(filterMonitoringIntervalMs, this.filterMonitoringDeviceIds, applyFilterUpdate);
		}

		this.log.debug(`onConfigure: exit — polling started at ${this.thinqPollingIntervalMs}ms interval`);
	}

	public override async onShutdown(reason?: string): Promise<void> {
		await super.onShutdown(reason);
		this.log.debug(`onShutdown: entry (reason=${reason ?? 'none'})`);
		this.log.notice('onShutdown called with reason:', reason ?? 'none');

		if (this.thinqConnectServices) {
			this.thinqConnectServices.shutdown();
		} else {
			this.thinqServices.getDeviceService().stopPolling();
			this.thinqServices.getDeviceService().stopKeepAlive();
			this.thinqServices.getMqttListener().stop();
			this.thinqServices.getFilterMonitoringService().stopPolling();
		}

		if (this.configManager.unregisterOnShutdown) {
			await this.unregisterAllDevices(UNREGISTER_DEVICES_DELAY_MS);
		}

		this.state.setStartupCompleted(false);
		this.log.debug('onShutdown: exit');
	}

	/**
	 * Discovers ThinQ Connect (PAT) washers and air conditioners and registers each as a Matter endpoint
	 * (LaundryWasher / room air conditioner).
	 */
	private async startThinqConnectDevices(): Promise<void> {
		const container = this.thinqConnectServices;
		if (!container) {
			throw new Error('ThinQ Connect services not initialized');
		}
		const service = container.getWasherService();

		this.thinqConnectWashers = await registerThinqConnectWashers({
			service,
			logger: this.log,
			isIgnored: (id) => this.configManager.isDeviceIgnored(id),
			resolveIdentity: (id) => this.resolveThinqConnectMatterIdentity(id),
			registerDevice: (endpoint) => this.registerDevice(endpoint),
			unregisterIgnoredDevice: (id, endpoint) => this.unregisterIgnoredDevice(id, endpoint),
			remember: (id, endpoint) => this.registry.register(id, endpoint),
		});

		this.log.notice(`ThinQ Connect (PAT): registered ${this.thinqConnectWashers.length} washer(s).`);

		try {
			this.thinqConnectAirConditioners = await registerThinqConnectAirConditioners({
				service: container.getAirConditionerService(),
				logger: this.log,
				isIgnored: (id) => this.configManager.isDeviceIgnored(id),
				resolveIdentity: (id) => this.resolveThinqConnectMatterIdentity(id),
				registerDevice: (endpoint) => this.registerDevice(endpoint),
				unregisterIgnoredDevice: (id, endpoint) => this.unregisterIgnoredDevice(id, endpoint),
				remember: (id, endpoint) => this.registry.register(id, endpoint),
			});
		} catch (error) {
			this.log.error(
				`ThinQ Connect (PAT): air conditioner discovery failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		this.log.notice(`ThinQ Connect (PAT): registered ${this.thinqConnectAirConditioners.length} air conditioner(s).`);

		if (this.thinqConnectWashers.length === 0 && this.thinqConnectAirConditioners.length === 0) {
			this.log.notice(
				'ThinQ Connect (PAT): no washer or air conditioner found. Only washers and air conditioners are supported with a Personal Access Token in this version.',
			);
		}
	}

	/**
	 * Resolves the same per-device Matter overrides V1 applies (`overrideMatterConfiguration` gated),
	 * as plain data. Undefined fields fall back to the ThinQ Connect builder defaults.
	 */
	private resolveThinqConnectMatterIdentity(deviceId: string): ThinqConnectMatterIdentityOverride {
		const vendor = this.configManager.overrideMatterConfiguration
			? this.configManager.matterOverrideSettings
			: undefined;
		return {
			vendorId: vendor?.matterVendorId,
			vendorName: vendor?.matterVendorName,
			productId: this.configManager.getProductIdForDevice(deviceId),
			productName: this.configManager.getProductNameForDevice(deviceId),
		};
	}

	private startThinqConnectPolling(): void {
		const container = this.thinqConnectServices;
		if (!container) {
			throw new Error('ThinQ Connect services not initialized');
		}

		container.getWasherService().startPolling(container.pollIntervalMs, this.thinqConnectWashers, (deviceId, state) => {
			const endpoint = this.registry.getDevice(deviceId) as MatterbridgeEndpoint | undefined;
			if (!endpoint) {
				this.log.debug(`ThinQ Connect state update received for unregistered device ${deviceId}, skipping.`);
				return;
			}
			void applyThinqConnectWasherState(endpoint, state, this.log).catch((error: unknown) => {
				this.log.error(
					`Failed to apply ThinQ Connect state update for ${deviceId}: ${error instanceof Error ? error.message : String(error)}`,
				);
			});
		});
		const airConditionersById = new Map(this.thinqConnectAirConditioners.map((ac) => [ac.deviceId, ac]));
		container
			.getAirConditionerService()
			.startPolling(container.pollIntervalMs, this.thinqConnectAirConditioners, (deviceId, state) => {
				const endpoint = this.registry.getDevice(deviceId) as MatterbridgeEndpoint | undefined;
				const ac = airConditionersById.get(deviceId);
				if (!endpoint || !ac) {
					this.log.debug(`ThinQ Connect state update received for unregistered device ${deviceId}, skipping.`);
					return;
				}
				void applyThinqConnectAirConditionerState(endpoint, ac, state, this.log).catch((error: unknown) => {
					this.log.error(
						`Failed to apply ThinQ Connect state update for ${deviceId}: ${error instanceof Error ? error.message : String(error)}`,
					);
				});
			});
		this.log.debug(`ThinQ Connect polling started at ${container.pollIntervalMs}ms interval`);
	}

	/**
	 * Authenticates against LG ThinQ (account or token strategy), discovers AirConditioner devices,
	 * and registers each of them with Matterbridge. Ports the sibling plugin's discovery/configure split.
	 */
	private async startThinqDevices(): Promise<void> {
		const loginType = this.configManager.thinqLoginType;
		if (loginType === 'pat') {
			throw new Error('startThinqDevices called with a Personal Access Token login (EMP login required).');
		}

		const userDataRepository = this.thinqServices.getUserDataRepository();
		let userData = this.configManager.isForceAuthenticationEnabled
			? undefined
			: await userDataRepository.loadUserData();

		if (!userData) {
			userData = await this.thinqServices.getAuthenticationCoordinator().authenticate(loginType, {
				username: this.configManager.thinqUsername,
				password: this.configManager.thinqPassword,
				refreshToken: this.configManager.thinqRefreshToken,
				country: this.configManager.country,
				language: this.configManager.language,
			});
		}

		if (!userData) {
			throw new ManualProcessNeededError(
				'LG ThinQ authentication did not return user data. This account likely uses a third-party SSO login ' +
					'(Google/Apple/Facebook/Amazon), which is not yet supported headlessly — please log in with a native ' +
					'LG account (email/password) or refresh token instead.',
				{ reason: 'THIRD_PARTY_SSO_NOT_SUPPORTED' },
			);
		}

		this.thinqServices.apiClient.setSession(ThinqSession.fromData(userData));
		if (userData.userNumber) {
			this.thinqServices.apiClient.setUserNumber(userData.userNumber);
		}
		await userDataRepository.saveUserData(userData);

		const devices = await this.thinqServices.getDeviceDiscovery().discoverDevices();

		const configChanged = reconcileThinqDeviceConfigEntries(this.config.thinq.devices, devices);
		if (configChanged) {
			try {
				this.saveConfig(this.config);
			} catch (error) {
				this.log.error(
					`Failed to persist auto-populated ThinQ device config: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		const configurator = this.thinqServices.getDeviceConfigurator();

		for (const device of devices) {
			if (isAirConditionerDevice(device)) {
				const airConditioner = await configurator.registerAirConditioner(device);
				if (this.configManager.isDeviceIgnored(device.id)) {
					await this.unregisterIgnoredDevice(device.id, airConditioner);
					continue;
				}
				await this.registerDevice(airConditioner);
				this.registry.register(device.id, airConditioner);
				this.thinqDeviceKindById.set(device.id, 'AC');
				if (this.configManager.getDeviceCapabilities(device.id).supportsFilterMonitoring) {
					this.filterMonitoringDeviceIds.push(device.id);
				}
				continue;
			}

			if (isWasherDevice(device)) {
				const washer = await configurator.registerWasher(device);
				if (this.configManager.isDeviceIgnored(device.id)) {
					await this.unregisterIgnoredDevice(device.id, washer);
					continue;
				}
				await this.registerDevice(washer);
				this.registry.register(device.id, washer);
				this.thinqDeviceKindById.set(device.id, 'WASHER');
				continue;
			}
		}

		if (configurator.consumeCourseConfigChanged()) {
			try {
				this.saveConfig(this.config);
			} catch (error) {
				this.log.error(
					`Failed to persist auto-populated ThinQ washer course config: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}

	private async unregisterIgnoredDevice(deviceId: string, endpoint: MatterbridgeEndpoint): Promise<void> {
		this.log.notice(`Unregistering ignored device: ${deviceId}`);
		await this.registerDevice(endpoint);
		await this.unregisterDevice(endpoint);
	}

	public override async onChangeLoggerLevel(logLevel: LogLevel): Promise<void> {
		this.log.notice(`Change ${PLUGIN_NAME} log level: ${logLevel} (was ${this.log.logLevel})`);
		this.log.logLevel = logLevel;
	}
	// #endregion Lifecycle
}
