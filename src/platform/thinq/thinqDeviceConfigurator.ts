import { MatterbridgeEndpoint } from 'matterbridge';
import { AnsiLogger } from 'matterbridge/logger';
import { FanControl } from 'matterbridge/matter/clusters';

import type { ThinqAirConditionerDevice, ThinqWasherDevice } from '../../core/domain/entities/ThinqDevice.js';
import type { ThinqWasherControlConfig } from '../../model/LgThinqPluginPlatformConfig.js';
import type { ThinqApiClient } from '../../services/thinq/thinqApiClient.js';
import { maskSecret } from '../../utils/mask.js';
import { PlatformConfigManager } from '../platformConfigManager.js';
import {
	registerAirConditionerCommandHandlers,
	THINQ_FAN_SPEED_AUTO,
	THINQ_FAN_SPEED_LOW,
	THINQ_FAN_SPEED_MEDIUM,
} from './thinqAirConditionerCommandHandlers.js';
import { buildAirConditionerEndpoint } from './thinqAirConditionerEndpointFactory.js';
import { registerFilterResetCommandHandler } from './thinqAirConditionerFilterResetCommandHandler.js';
import { registerWasherCommandHandlers } from './thinqWasherCommandHandlers.js';
import { extractWasherCourseCatalog, type WasherCourseCatalog } from './thinqWasherCourseCatalogResolver.js';
import { reconcileWasherCourseConfig } from './thinqWasherCourseConfigReconciler.js';
import { resolveWasherCourseSelectionFromConfig } from './thinqWasherCourseSelectionResolver.js';
import { buildWasherEndpoint } from './thinqWasherEndpointFactory.js';
import {
	buildWasherEndpointClusterOptions,
	resolveWasherMatterPlan,
	type WasherMatterPlan,
	washerMatterPlanRefusalReason,
} from './thinqWasherMatterPlan.js';
import { extractWasherStartCommand, type WasherStartCommandPayload } from './thinqWasherStartCommandResolver.js';
import {
	extractWasherPauseCommand,
	extractWasherStopCommand,
	type WasherPauseCommandPayload,
	type WasherStopCommandPayload,
} from './thinqWasherStopCommandResolver.js';
import { createWasherVtPorts, registerWasherVtCommandHandlers } from './thinqWasherVtCommandHandlers.js';
import { WasherVtController } from './thinqWasherVtController.js';
import { buildWasherOspWakeBody } from './thinqWasherVtCtrl.js';
import { isWasherVtSupported, resolveWasherVtStagePlan } from './thinqWasherVtStagePlan.js';

const DEFAULT_TEMPERATURE_CELSIUS = 20;
const MAX_HEAT_SETPOINT_LIMIT_CELSIUS = 30;
const MIN_COOL_SETPOINT_LIMIT_CELSIUS = 18;

const DEFAULT_PRODUCT_IDENTITY: Record<'AC' | 'WASHER', { productId: number; productName: string }> = {
	AC: { productId: 0x8000, productName: 'LG Air Conditioner' },
	WASHER: { productId: 0x8001, productName: 'LG Washer' },
};

export function mapWindStrengthToFanMode(windStrength: number | undefined): FanControl.FanMode {
	if (windStrength === undefined || windStrength === THINQ_FAN_SPEED_AUTO) {
		return FanControl.FanMode.Auto;
	}
	if (windStrength <= THINQ_FAN_SPEED_LOW) {
		return FanControl.FanMode.Low;
	}
	if (windStrength <= THINQ_FAN_SPEED_MEDIUM) {
		return FanControl.FanMode.Medium;
	}
	return FanControl.FanMode.High;
}

export function mapWindStrengthToFixedFanMode(windStrength: number | undefined): FanControl.FanMode {
	return windStrength === undefined ? FanControl.FanMode.Off : FanControl.FanMode.High;
}

/**
 * Builds Matterbridge `AirConditioner` device endpoints from a ThinQ AirConditioner snapshot
 * (mirrors `matterbridge-example-dynamic-platform/src/module.ts:2726-2734`).
 */
export class ThinqDeviceConfigurator {
	private courseConfigChanged = false;
	private readonly washerMatterPlans = new Map<string, WasherMatterPlan>();

	constructor(
		private readonly logger: AnsiLogger,
		private readonly apiClient: ThinqApiClient,
		private readonly configManager: PlatformConfigManager,
	) {}

	public consumeCourseConfigChanged(): boolean {
		const changed = this.courseConfigChanged;
		this.courseConfigChanged = false;
		return changed;
	}

	public getWasherMatterPlan(deviceId: string): WasherMatterPlan | undefined {
		return this.washerMatterPlans.get(deviceId);
	}

	private resolveProductIdentity(device: ThinqAirConditionerDevice | ThinqWasherDevice): {
		productId: number;
		productName: string;
	} {
		const productIdOverride = this.configManager.getProductIdForDevice(device.id);
		const productNameOverride = this.configManager.getProductNameForDevice(device.id);
		const defaultIdentity = DEFAULT_PRODUCT_IDENTITY[device.type];

		return {
			productId: productIdOverride ?? defaultIdentity.productId,
			productName: productNameOverride ?? defaultIdentity.productName,
		};
	}

	public async registerAirConditioner(device: ThinqAirConditionerDevice): Promise<MatterbridgeEndpoint> {
		const snapshot = device.snapshot;
		const currentTemperature = snapshot.currentTemperatureCelsius ?? DEFAULT_TEMPERATURE_CELSIUS;
		const targetTemperature = snapshot.targetTemperatureCelsius ?? DEFAULT_TEMPERATURE_CELSIUS;
		const capabilities = this.configManager.getDeviceCapabilities(device.id);

		this.logger.debug(`registerAirConditioner: entry for deviceId=${device.id}`);
		this.logger.info(`Registering ThinQ AirConditioner: ${device.name} (${device.id})`);

		const initialFanMode = capabilities.supportsFanSpeedControl
			? mapWindStrengthToFanMode(snapshot.windStrength)
			: mapWindStrengthToFixedFanMode(snapshot.windStrength);

		const matterOverride = this.configManager.overrideMatterConfiguration
			? this.configManager.matterOverrideSettings
			: undefined;
		const productIdentity = this.resolveProductIdentity(device);

		const airConditioner = buildAirConditionerEndpoint(
			device,
			capabilities,
			{
				currentTemperature,
				targetTemperature,
				minHeatSetpointLimitCelsius: 0,
				maxHeatSetpointLimitCelsius: MAX_HEAT_SETPOINT_LIMIT_CELSIUS,
				minCoolSetpointLimitCelsius: MIN_COOL_SETPOINT_LIMIT_CELSIUS,
				maxCoolSetpointLimitCelsius: 50,
			},
			initialFanMode,
			{
				vendorId: matterOverride?.matterVendorId,
				vendorName: matterOverride?.matterVendorName,
				productId: productIdentity.productId,
				productName: productIdentity.productName,
			},
		)
			.createDefaultTemperatureMeasurementClusterServer(currentTemperature * 100)
			.addRequiredClusterServers();

		// Hardcoded: the AC is always exposed as its own standalone Matter node (server mode) so it can get its own
		// power tile in Apple Home. Not user-configurable.
		airConditioner.mode = 'server';

		registerAirConditionerCommandHandlers(airConditioner, device, this.apiClient, this.logger, capabilities);

		const filterResetControl = this.configManager.getAcFilterControlConfig(device.id);
		registerFilterResetCommandHandler(
			airConditioner,
			device,
			this.apiClient,
			this.logger,
			capabilities,
			filterResetControl,
		);

		this.logger.debug(`registerAirConditioner: completed for deviceId=${device.id}`);
		return Promise.resolve(airConditioner);
	}

	public async registerWasher(device: ThinqWasherDevice): Promise<MatterbridgeEndpoint> {
		this.logger.debug(`registerWasher: entry for deviceId=${device.id}`);
		this.logger.info(`Registering ThinQ Washer: ${device.name} (${device.id})`);

		const matterOverride = this.configManager.overrideMatterConfiguration
			? this.configManager.matterOverrideSettings
			: undefined;
		const productIdentity = this.resolveProductIdentity(device);

		// The model is fetched before the endpoint is built: LaundryWasherMode.supportedModes is a Fixed attribute.
		const {
			pause: pauseCommandPayload,
			stop: stopCommandPayload,
			vtModel,
		} = await this.resolveWasherPauseAndStopCommandPayloads(device);

		const plan = vtModel === undefined ? undefined : resolveWasherMatterPlan(vtModel);
		if (plan !== undefined) {
			this.washerMatterPlans.set(device.id, plan);
		} else {
			this.washerMatterPlans.delete(device.id);
		}

		const washer = buildWasherEndpoint(
			device,
			{
				vendorId: matterOverride?.matterVendorId,
				vendorName: matterOverride?.matterVendorName,
				productId: productIdentity.productId,
				productName: productIdentity.productName,
			},
			plan === undefined ? undefined : buildWasherEndpointClusterOptions(plan, device.snapshot, this.logger),
		);

		// Hardcoded: the washer is always exposed as its own standalone Matter node (server mode), matching the AC.
		washer.mode = 'server';
		if (vtModel !== undefined) {
			this.logWasherMatterPlan(device, vtModel, plan);
		}

		const courseCatalog = await this.resolveWasherCourseCatalog(device);
		if (courseCatalog) {
			const liveWasherControlEntry = this.configManager.ensureWasherControlEntry(device.id);
			if (reconcileWasherCourseConfig(liveWasherControlEntry, courseCatalog)) {
				this.courseConfigChanged = true;
			}
		}

		if (vtModel) {
			this.registerWasherVtControl(washer, device, vtModel);
			this.logger.debug(`registerWasher: completed for deviceId=${device.id}`);
			return washer;
		}

		const startCommandPayload = await this.resolveWasherStartCommandPayload(
			device,
			this.configManager.getWasherControlConfig(device.id),
		);
		registerWasherCommandHandlers(washer, device, this.apiClient, this.logger, {
			pause: pauseCommandPayload,
			stop: stopCommandPayload,
			start: startCommandPayload,
		});

		this.logger.debug(`registerWasher: completed for deviceId=${device.id}`);
		return washer;
	}

	private logWasherMatterPlan(
		device: ThinqWasherDevice,
		vtModel: Record<string, unknown>,
		plan: WasherMatterPlan | undefined,
	): void {
		const maskedId = maskSecret(device.id, 4);
		if (plan === undefined) {
			this.logger.warn(
				`ThinQ Washer ${maskedId}: ${washerMatterPlanRefusalReason(vtModel)}; Home shows the placeholder course list`,
			);
			return;
		}
		this.logger.info(
			`ThinQ Washer ${maskedId}: ${plan.modes.length} course(s) exposed as modes, Normal-tagged course ${plan.normalCourseId} (display only)`,
		);
	}

	private registerWasherVtControl(
		washer: MatterbridgeEndpoint,
		device: ThinqWasherDevice,
		vtModel: Record<string, unknown>,
	): void {
		const washerControl = this.configManager.getWasherControlConfig(device.id);
		const stagePlan = resolveWasherVtStagePlan(vtModel, washerControl);
		const maskedId = maskSecret(device.id, 4);
		this.logger.info(`ThinQ Washer ${maskedId}: uses the LG app's vtCtrl commands`);
		if (stagePlan) {
			this.logger.info(
				`ThinQ Washer ${maskedId}: Start stages course ${stagePlan.courseId}${Object.keys(stagePlan.options).length > 0 ? ` with ${JSON.stringify(stagePlan.options)}` : ''}`,
			);
			if (stagePlan.ignoredOptions.length > 0) {
				this.logger.warn(
					`ThinQ Washer ${maskedId}: ignored course settings (default or not allowed for this course): ${stagePlan.ignoredOptions.join(', ')}`,
				);
			}
		} else {
			this.logger.warn(
				`ThinQ Washer ${maskedId}: no valid Selected Wash Course; Start will only work after you press Remote Control, with the course shown on the washer`,
			);
		}

		const controller = new WasherVtController(maskedId, createWasherVtPorts(device, this.apiClient), this.logger, {
			allowCancelCycle: washerControl.allowCancelCycle === true,
			stagePlan,
			wakeBody: buildWasherOspWakeBody(vtModel),
		});
		registerWasherVtCommandHandlers(washer, device, controller, this.logger);
	}

	/**
	 * Resolves the real pause (`WMStop`, LG PAUSE) and stop (`WMOff`, LG POWEROFF) command payloads from
	 * the device's own downloaded model JSON, with one model fetch. Runs unconditionally at registration
	 * (read-only GET, no washer state mutated) so the resolved payloads are visible in the logs for manual
	 * sanity-checking. Never throws — any fetch/parse failure resolves both to `undefined`, so a broken
	 * model-JSON URL can never block washer registration.
	 */
	private async resolveWasherPauseAndStopCommandPayloads(device: ThinqWasherDevice): Promise<{
		pause: WasherPauseCommandPayload | undefined;
		stop: WasherStopCommandPayload | undefined;
		vtModel: Record<string, unknown> | undefined;
	}> {
		if (!device.modelJsonUri) {
			return { pause: undefined, stop: undefined, vtModel: undefined };
		}

		try {
			const model = await this.apiClient.getDeviceModel(device.modelJsonUri);
			if (isWasherVtSupported(model)) {
				return { pause: undefined, stop: undefined, vtModel: model };
			}
			const pause = extractWasherPauseCommand(model);
			const stop = extractWasherStopCommand(model);

			if (pause) {
				this.logger.info(
					`ThinQ Washer ${device.id}: resolved pause-command payload from device model: ${JSON.stringify(pause)}`,
				);
			} else {
				this.logger.warn(
					`ThinQ Washer ${device.id}: device model has no WMStop (pause) entry. Pause from Matter will be rejected until this is resolved.`,
				);
			}

			if (stop) {
				this.logger.info(
					`ThinQ Washer ${device.id}: resolved stop-command (power-off) payload from device model: ${JSON.stringify(stop)}`,
				);
			} else {
				this.logger.warn(
					`ThinQ Washer ${device.id}: device model has no WMOff (power-off) entry. Stop from Matter will be rejected until this is resolved.`,
				);
			}

			return { pause, stop, vtModel: undefined };
		} catch (error) {
			this.logger.debug(
				`ThinQ Washer ${device.id}: failed to resolve pause/stop-command payloads from device model: ${error instanceof Error ? error.message : String(error)}`,
			);
			return { pause: undefined, stop: undefined, vtModel: undefined };
		}
	}

	/**
	 * Resolves a real `WMStart` command payload from the device's own downloaded model JSON.
	 * Runs unconditionally at registration (read-only GET, no washer state mutated) so the resolved
	 * payload is visible in the logs for manual sanity-checking. Never throws — any
	 * fetch/parse failure resolves to `undefined`, so a broken model-JSON URL can never block washer
	 * registration. Deliberately performs its own independent `getDeviceModel()` fetch rather than
	 * sharing the model already fetched by `resolveWasherPauseAndStopCommandPayloads()`.
	 */
	private async resolveWasherStartCommandPayload(
		device: ThinqWasherDevice,
		washerControl: ThinqWasherControlConfig,
	): Promise<WasherStartCommandPayload | undefined> {
		if (!device.modelJsonUri) {
			return undefined;
		}

		try {
			const model = await this.apiClient.getDeviceModel(device.modelJsonUri);
			const courseSelection = resolveWasherCourseSelectionFromConfig(washerControl);
			const payload = extractWasherStartCommand(model, courseSelection);
			if (payload) {
				this.logger.info(
					`ThinQ Washer ${device.id}: resolved start-command payload from device model: ${JSON.stringify(payload)} (course=${payload.resolvedCourseId})`,
				);
			} else {
				this.logger.warn(
					`ThinQ Washer ${device.id}: device model has no usable WMStart/default-course entry. Remote Start from Matter will be rejected until this is resolved.`,
				);
			}
			return payload;
		} catch (error) {
			this.logger.debug(
				`ThinQ Washer ${device.id}: failed to resolve start-command payload from device model: ${error instanceof Error ? error.message : String(error)}`,
			);
			return undefined;
		}
	}

	/**
	 * Resolves the device's full wash-course catalog from its own downloaded model JSON, for config
	 * auto-fill. Runs unconditionally at registration (read-only GET), never throws — any fetch/parse
	 * failure resolves to `undefined` so a broken model-JSON URL can never block washer registration.
	 * Deliberately performs its own independent `getDeviceModel()` fetch rather than sharing the model
	 * already fetched by the pause/stop/start resolvers.
	 */
	private async resolveWasherCourseCatalog(device: ThinqWasherDevice): Promise<WasherCourseCatalog | undefined> {
		if (!device.modelJsonUri) {
			return undefined;
		}

		try {
			const model = await this.apiClient.getDeviceModel(device.modelJsonUri);
			const catalog = extractWasherCourseCatalog(model);
			if (catalog) {
				this.logger.info(
					`ThinQ Washer ${device.id}: resolved ${catalog.courses.length} course(s) from device model for config auto-fill.`,
				);
			} else {
				this.logger.info(`ThinQ Washer ${device.id}: device model has no usable Course entries for config auto-fill.`);
			}
			return catalog;
		} catch (error) {
			this.logger.debug(
				`ThinQ Washer ${device.id}: failed to resolve course catalog from device model: ${error instanceof Error ? error.message : String(error)}`,
			);
			return undefined;
		}
	}
}
