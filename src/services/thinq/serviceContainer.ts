import { AnsiLogger } from 'matterbridge/logger';
import { LocalStorage } from 'node-persist';

import { PlatformConfigManager } from '../../platform/platformConfigManager.js';
import { ThinqDeviceConfigurator } from '../../platform/thinq/thinqDeviceConfigurator.js';
import { ThinqDeviceDiscovery } from '../../platform/thinq/thinqDeviceDiscovery.js';
import { AccountAuthStrategy } from '../authentication/AccountAuthStrategy.js';
import { AuthenticationCoordinator } from '../authentication/AuthenticationCoordinator.js';
import { TokenAuthStrategy } from '../authentication/TokenAuthStrategy.js';
import { UserDataRepository } from '../authentication/UserDataRepository.js';
import { MqttKeyRepository } from './mqtt/mqttKeyRepository.js';
import { ThinqMqttListener } from './mqtt/thinqMqttListener.js';
import { ThinqSession } from './session.js';
import { ThinqApiClient } from './thinqApiClient.js';
import { ThinqDeviceService } from './thinqDeviceService.js';
import { ThinqFilterMonitoringService } from './thinqFilterMonitoringService.js';

/** DI container wiring together ThinQ authentication, discovery, polling, and MQTT push services (singletons). */
export class ThinqServiceContainer {
	private readonly apiClientInstance: ThinqApiClient;
	private authenticationCoordinatorInstance: AuthenticationCoordinator | undefined;
	private deviceServiceInstance: ThinqDeviceService | undefined;
	private filterMonitoringServiceInstance: ThinqFilterMonitoringService | undefined;
	private deviceDiscoveryInstance: ThinqDeviceDiscovery | undefined;
	private deviceConfiguratorInstance: ThinqDeviceConfigurator | undefined;
	private userDataRepositoryInstance: UserDataRepository | undefined;
	private mqttKeyRepositoryInstance: MqttKeyRepository | undefined;
	private mqttListenerInstance: ThinqMqttListener | undefined;

	constructor(
		private readonly logger: AnsiLogger,
		private readonly persist: LocalStorage,
		private readonly configManager: PlatformConfigManager,
		private readonly mqttCertDir: string,
	) {
		this.apiClientInstance = new ThinqApiClient(
			new ThinqSession('', '', 0),
			this.configManager.country,
			this.configManager.language,
			this.logger,
		);
	}

	public get apiClient(): ThinqApiClient {
		return this.apiClientInstance;
	}

	public getUserDataRepository(): UserDataRepository {
		this.userDataRepositoryInstance ??= new UserDataRepository(this.persist, this.configManager, this.logger);
		return this.userDataRepositoryInstance;
	}

	public getAuthenticationCoordinator(): AuthenticationCoordinator {
		if (!this.authenticationCoordinatorInstance) {
			const accountStrategy = new AccountAuthStrategy(this.apiClientInstance, this.logger);
			const tokenStrategy = new TokenAuthStrategy(this.apiClientInstance, this.logger);
			this.authenticationCoordinatorInstance = new AuthenticationCoordinator(
				accountStrategy,
				tokenStrategy,
				this.apiClientInstance,
				this.logger,
			);
		}
		return this.authenticationCoordinatorInstance;
	}

	public getDeviceService(): ThinqDeviceService {
		this.deviceServiceInstance ??= new ThinqDeviceService(this.apiClientInstance, this.logger);
		return this.deviceServiceInstance;
	}

	public getFilterMonitoringService(): ThinqFilterMonitoringService {
		this.filterMonitoringServiceInstance ??= new ThinqFilterMonitoringService(this.apiClientInstance, this.logger);
		return this.filterMonitoringServiceInstance;
	}

	public getDeviceDiscovery(): ThinqDeviceDiscovery {
		this.deviceDiscoveryInstance ??= new ThinqDeviceDiscovery(this.getDeviceService(), this.logger);
		return this.deviceDiscoveryInstance;
	}

	public getDeviceConfigurator(): ThinqDeviceConfigurator {
		this.deviceConfiguratorInstance ??= new ThinqDeviceConfigurator(
			this.logger,
			this.apiClientInstance,
			this.configManager,
		);
		return this.deviceConfiguratorInstance;
	}

	public getMqttListener(): ThinqMqttListener {
		this.mqttListenerInstance ??= new ThinqMqttListener(
			this.apiClientInstance,
			this.getMqttKeyRepository(),
			this.mqttCertDir,
			this.logger,
		);
		return this.mqttListenerInstance;
	}

	private getMqttKeyRepository(): MqttKeyRepository {
		this.mqttKeyRepositoryInstance ??= new MqttKeyRepository(this.persist, this.logger);
		return this.mqttKeyRepositoryInstance;
	}
}
