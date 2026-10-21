import { humiditySensor, MatterbridgeEndpoint, powerSource, roomAirConditioner } from 'matterbridge';
import type { AnsiLogger } from 'matterbridge/logger';
import {
	FanControl,
	HepaFilterMonitoring,
	OnOff,
	RelativeHumidityMeasurement,
	ResourceMonitoring,
	Thermostat,
} from 'matterbridge/matter/clusters';

import type { AirConditionerProfile } from '../services/thinqConnect/thinqConnectAirConditioner.js';
import type {
	ThinqV2AirConditioner,
	ThinqV2AirConditionerOutcome,
	ThinqV2AirConditionerService,
	ThinqV2AirConditionerState,
} from './thinqV2AirConditionerService.js';

type FanTier = 'complete' | 'default' | 'onOff';
type WindStrength = 'LOW' | 'MID' | 'HIGH' | 'AUTO';

const DEFAULT_MIN_CELSIUS = 16;
const DEFAULT_MAX_CELSIUS = 30;
const FILTER_WARNING_THRESHOLD_PERCENT = 10;
const PERCENT_LOW_MAX = 33;
const PERCENT_MID_MAX = 66;

const WIND_PERCENT = new Map<string, number>([
	['LOW', 20],
	['MID', 50],
	['HIGH', 90],
]);

const WIND_TO_FAN_MODE = new Map<string, FanControl.FanMode>([
	['LOW', FanControl.FanMode.Low],
	['MID', FanControl.FanMode.Medium],
	['HIGH', FanControl.FanMode.High],
	['AUTO', FanControl.FanMode.Auto],
]);

const FAN_MODE_TO_WIND = new Map<FanControl.FanMode, WindStrength>([
	[FanControl.FanMode.Low, 'LOW'],
	[FanControl.FanMode.Medium, 'MID'],
	[FanControl.FanMode.High, 'HIGH'],
	[FanControl.FanMode.Auto, 'AUTO'],
]);

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function mapWindStrengthToFanMode(strength: string | undefined): FanControl.FanMode | undefined {
	return strength === undefined ? undefined : WIND_TO_FAN_MODE.get(strength);
}

export function mapFanModeToWindStrength(mode: FanControl.FanMode): WindStrength | undefined {
	return FAN_MODE_TO_WIND.get(mode);
}

export function mapPercentToWindStrength(percent: number): 'LOW' | 'MID' | 'HIGH' | undefined {
	if (percent <= 0) {
		return undefined;
	}
	if (percent <= PERCENT_LOW_MAX) {
		return 'LOW';
	}
	return percent <= PERCENT_MID_MAX ? 'MID' : 'HIGH';
}

export function mapWindStrengthToPercent(strength: string | undefined): number | undefined {
	return strength === undefined ? undefined : WIND_PERCENT.get(strength);
}

export function resolveFilterChangeIndication(remainingPercent: number): ResourceMonitoring.ChangeIndication {
	if (remainingPercent <= 0) {
		return ResourceMonitoring.ChangeIndication.Critical;
	}
	if (remainingPercent <= FILTER_WARNING_THRESHOLD_PERCENT) {
		return ResourceMonitoring.ChangeIndication.Warning;
	}
	return ResourceMonitoring.ChangeIndication.Ok;
}

/** Fan cluster feature set is fixed at creation, so construction and state sync both derive it from the profile. */
export function describeFanTier(profile: AirConditionerProfile): FanTier {
	if (!profile.windStrength?.writable) {
		return 'onOff';
	}
	return profile.rotateUpDown || profile.rotateLeftRight ? 'complete' : 'default';
}

function thermostatLimitsCelsius(ac: ThinqV2AirConditioner): { min: number; max: number } {
	const range = ac.profile.targetTemperature;
	if (!range) {
		return { min: DEFAULT_MIN_CELSIUS, max: DEFAULT_MAX_CELSIUS };
	}
	return { min: Math.ceil(range.min * 2) / 2, max: Math.floor(range.max * 2) / 2 };
}

/**
 * Builds the Matter room-air-conditioner endpoint for a ThinQ Connect air conditioner. Thermostat/fan writes
 * arrive as raw attribute writes, so they are observed with `subscribeAttribute` (ignoring our own
 * `updateAttribute` echoes) and always re-synced to the real device state afterwards.
 */
export function buildThinqV2AirConditionerEndpoint(
	ac: ThinqV2AirConditioner,
	service: Pick<
		ThinqV2AirConditionerService,
		'setPower' | 'setCoolMode' | 'setTargetTemperature' | 'setWindStrength' | 'setSwing'
	>,
	logger: AnsiLogger,
): MatterbridgeEndpoint {
	const { profile } = ac;
	const limits = thermostatLimitsCelsius(ac);
	const midpoint = Math.round((limits.min + limits.max) / 2);
	const clampCelsius = (value: number): number => Math.min(limits.max, Math.max(limits.min, Math.round(value)));
	const initialLocal = clampCelsius(ac.initialState?.currentTemperatureC ?? midpoint);
	const initialTarget = clampCelsius(ac.initialState?.targetTemperatureC ?? midpoint);
	const fanTier = describeFanTier(profile);

	const endpoint = new MatterbridgeEndpoint([roomAirConditioner, powerSource], {
		id: `${ac.name.replaceAll(' ', '')}-${ac.deviceId.replaceAll(' ', '')}`,
	})
		.createDefaultIdentifyClusterServer()
		.createDefaultBasicInformationClusterServer(
			ac.name,
			ac.deviceId,
			0xfff1,
			'Matterbridge',
			0x8000,
			'LG Air Conditioner',
		)
		.createDefaultPowerSourceWiredClusterServer()
		.createDeadFrontOnOffClusterServer(ac.initialState?.powerOn ?? false)
		.createDefaultCoolingThermostatClusterServer(initialLocal, initialTarget, limits.min, limits.max)
		.createDefaultThermostatUserInterfaceConfigurationClusterServer();

	if (fanTier === 'complete') {
		endpoint.createCompleteFanControlClusterServer(
			FanControl.FanMode.Auto,
			FanControl.FanModeSequence.OffLowMedHighAuto,
			0,
			0,
			undefined,
			undefined,
			undefined,
			{ rockLeftRight: profile.rotateLeftRight, rockUpDown: profile.rotateUpDown, rockRound: false },
			{ rockLeftRight: false, rockUpDown: false, rockRound: false },
		);
	} else if (fanTier === 'default') {
		endpoint.createDefaultFanControlClusterServer(
			FanControl.FanMode.Auto,
			FanControl.FanModeSequence.OffLowMedHighAuto,
			0,
			0,
		);
	} else {
		endpoint.createOnOffFanControlClusterServer(FanControl.FanMode.Auto);
	}

	if (profile.hasHumidity) {
		endpoint
			.addChildDeviceType('HumiditySensor', [humiditySensor])
			.createDefaultIdentifyClusterServer()
			.createDefaultRelativeHumidityMeasurementClusterServer(0);
	}

	if (profile.hasFilterInfo) {
		endpoint.createDefaultHepaFilterMonitoringClusterServer();
		endpoint.addCommandHandler('resetCondition', async () => {
			logger.warn(
				`ThinQ V2 ${ac.deviceId}: filter reset requested but is not available through the ThinQ Connect API.`,
			);
			throw new Error('Filter reset is not available through the ThinQ Connect API.');
		});
	}

	const settle = async (
		name: string,
		action: () => Promise<ThinqV2AirConditionerOutcome>,
		revert?: (state: ThinqV2AirConditionerState) => Promise<void>,
	): Promise<void> => {
		try {
			const outcome = await action();
			logger.debug(`ThinQ V2 ${ac.deviceId} ${name} -> ${outcome.status}`);
			await applyThinqV2AirConditionerState(endpoint, ac, outcome.state, logger);
			await revert?.(outcome.state);
		} catch (error) {
			logger.error(`ThinQ V2 ${ac.deviceId} ${name} handler failed: ${errorMessage(error)}`);
			try {
				await revert?.({});
			} catch (revertError) {
				logger.error(`ThinQ V2 ${ac.deviceId} ${name} revert failed: ${errorMessage(revertError)}`);
			}
		}
	};

	const handlePower = async (on: boolean): Promise<void> => {
		try {
			const outcome = await service.setPower(ac, on);
			logger.debug(`ThinQ V2 ${ac.deviceId} power ${on ? 'on' : 'off'} -> ${outcome.status}`);
			const powerOn = outcome.state.powerOn ?? (outcome.status === 'sent' ? on : !on);
			await applyThinqV2AirConditionerState(endpoint, ac, { ...outcome.state, powerOn }, logger);
		} catch (error) {
			logger.error(`ThinQ V2 ${ac.deviceId} power handler failed: ${errorMessage(error)}`);
		}
	};

	endpoint.addCommandHandler('on', async () => handlePower(true));
	endpoint.addCommandHandler('off', async () => handlePower(false));

	endpoint.subscribeAttribute(
		Thermostat.id,
		'occupiedCoolingSetpoint',
		(newValue: number, oldValue: number, context) => {
			if (context.fabric === undefined) {
				return;
			}
			void settle(
				'target temperature',
				() => service.setTargetTemperature(ac, newValue / 100),
				async (state) => {
					if (state.targetTemperatureC === undefined) {
						await endpoint.updateAttribute(Thermostat.id, 'occupiedCoolingSetpoint', oldValue, logger);
					}
				},
			);
		},
		endpoint.log,
	);

	const revertSystemMode =
		(oldValue: Thermostat.SystemMode) =>
		async (state: ThinqV2AirConditionerState): Promise<void> => {
			if (state.powerOn === undefined) {
				await endpoint.updateAttribute(Thermostat.id, 'systemMode', oldValue, logger);
			}
		};

	endpoint.subscribeAttribute(
		Thermostat.id,
		'systemMode',
		(newValue: Thermostat.SystemMode, oldValue: Thermostat.SystemMode, context) => {
			if (context.fabric === undefined) {
				return;
			}
			if (newValue === Thermostat.SystemMode.Off) {
				void settle('system mode off', () => service.setPower(ac, false), revertSystemMode(oldValue));
				return;
			}
			if (newValue === Thermostat.SystemMode.Cool) {
				void settle('system mode cool', () => service.setCoolMode(ac), revertSystemMode(oldValue));
				return;
			}
			logger.warn(`ThinQ V2 ${ac.deviceId}: system mode ${newValue} is not supported, reverting.`);
			void endpoint.updateAttribute(Thermostat.id, 'systemMode', oldValue, logger).catch((error: unknown) => {
				logger.error(`ThinQ V2 ${ac.deviceId} system mode revert failed: ${errorMessage(error)}`);
			});
		},
		endpoint.log,
	);

	if (fanTier === 'onOff') {
		return endpoint;
	}

	const revertFan = async (
		state: ThinqV2AirConditionerState,
		oldMode: FanControl.FanMode | undefined,
	): Promise<void> => {
		if (state.windStrength === undefined && oldMode !== undefined) {
			await endpoint.updateAttribute(FanControl.id, 'fanMode', oldMode, logger);
		}
	};

	endpoint.subscribeAttribute(
		FanControl.id,
		'fanMode',
		(newValue: FanControl.FanMode, oldValue: FanControl.FanMode, context) => {
			if (context.fabric === undefined) {
				return;
			}
			const strength = mapFanModeToWindStrength(newValue);
			if (strength === undefined) {
				logger.warn(`ThinQ V2 ${ac.deviceId}: fan mode ${newValue} is not supported, reverting.`);
				void endpoint.updateAttribute(FanControl.id, 'fanMode', oldValue, logger).catch((error: unknown) => {
					logger.error(`ThinQ V2 ${ac.deviceId} fan mode revert failed: ${errorMessage(error)}`);
				});
				return;
			}
			void settle(
				'fan mode',
				() => service.setWindStrength(ac, strength),
				(state) => revertFan(state, oldValue),
			);
		},
		endpoint.log,
	);

	endpoint.subscribeAttribute(
		FanControl.id,
		'percentSetting',
		(newValue: number | null, oldValue: number | null, context) => {
			if (context.fabric === undefined) {
				return;
			}
			const strength = newValue === null ? undefined : mapPercentToWindStrength(newValue);
			if (strength === undefined) {
				logger.debug(`ThinQ V2 ${ac.deviceId}: ignoring fan percent ${newValue}, reverting.`);
				void endpoint.updateAttribute(FanControl.id, 'percentSetting', oldValue, logger).catch((error: unknown) => {
					logger.error(`ThinQ V2 ${ac.deviceId} fan percent revert failed: ${errorMessage(error)}`);
				});
				return;
			}
			void settle(
				'fan percent',
				() => service.setWindStrength(ac, strength),
				async (state) => {
					if (state.windStrength === undefined) {
						await endpoint.updateAttribute(FanControl.id, 'percentSetting', oldValue, logger);
					}
				},
			);
		},
		endpoint.log,
	);

	if (fanTier === 'complete') {
		endpoint.subscribeAttribute(
			FanControl.id,
			'rockSetting',
			(newValue: unknown, oldValue: unknown, context) => {
				if (context.fabric === undefined) {
					return;
				}
				const next = newValue as { rockUpDown?: boolean; rockLeftRight?: boolean } | undefined;
				const previous = oldValue as { rockUpDown?: boolean; rockLeftRight?: boolean } | undefined;
				if (!next || !previous) {
					return;
				}
				const axes: { rotateUpDown?: boolean; rotateLeftRight?: boolean } = {};
				if (profile.rotateUpDown && next.rockUpDown !== previous.rockUpDown) {
					axes.rotateUpDown = next.rockUpDown === true;
				}
				if (profile.rotateLeftRight && next.rockLeftRight !== previous.rockLeftRight) {
					axes.rotateLeftRight = next.rockLeftRight === true;
				}
				const restoreRock = async (): Promise<void> => {
					await endpoint.updateAttribute(FanControl.id, 'rockSetting', previous, logger);
				};
				if (Object.keys(axes).length === 0) {
					void restoreRock().catch((error: unknown) => {
						logger.error(`ThinQ V2 ${ac.deviceId} swing revert failed: ${errorMessage(error)}`);
					});
					return;
				}
				void settle(
					'swing',
					() => service.setSwing(ac, axes),
					async (state) => {
						if (state.rotateUpDown === undefined && state.rotateLeftRight === undefined) {
							await restoreRock();
						}
					},
				);
			},
			endpoint.log,
		);
	}

	return endpoint;
}

export async function applyThinqV2AirConditionerState(
	endpoint: MatterbridgeEndpoint,
	ac: ThinqV2AirConditioner,
	state: ThinqV2AirConditionerState,
	logger: AnsiLogger,
): Promise<void> {
	const { profile } = ac;
	const limits = thermostatLimitsCelsius(ac);

	if (state.powerOn !== undefined) {
		await endpoint.updateAttribute(OnOff.id, 'onOff', state.powerOn, logger);
		await endpoint.updateAttribute(
			Thermostat.id,
			'systemMode',
			state.powerOn ? Thermostat.SystemMode.Cool : Thermostat.SystemMode.Off,
			logger,
		);
	}

	if (state.currentTemperatureC !== undefined) {
		await endpoint.updateAttribute(
			Thermostat.id,
			'localTemperature',
			Math.round(state.currentTemperatureC * 100),
			logger,
		);
	}

	if (state.targetTemperatureC !== undefined) {
		const clamped = Math.min(limits.max, Math.max(limits.min, state.targetTemperatureC));
		await endpoint.updateAttribute(Thermostat.id, 'occupiedCoolingSetpoint', Math.round(clamped * 100), logger);
	}

	const fanTier = describeFanTier(profile);
	if (fanTier !== 'onOff') {
		const fanMode = mapWindStrengthToFanMode(state.windStrength);
		if (fanMode !== undefined) {
			await endpoint.updateAttribute(FanControl.id, 'fanMode', fanMode, logger);
		}
		const percent = mapWindStrengthToPercent(state.windStrength);
		if (percent !== undefined) {
			await endpoint.updateAttribute(FanControl.id, 'percentCurrent', percent, logger);
			await endpoint.updateAttribute(FanControl.id, 'percentSetting', percent, logger);
		}
	}

	if (fanTier === 'complete' && (state.rotateUpDown !== undefined || state.rotateLeftRight !== undefined)) {
		const current = endpoint.getAttribute(FanControl.id, 'rockSetting') as
			{ rockUpDown?: boolean; rockLeftRight?: boolean } | undefined;
		await endpoint.updateAttribute(
			FanControl.id,
			'rockSetting',
			{
				rockUpDown: profile.rotateUpDown ? (state.rotateUpDown ?? current?.rockUpDown ?? false) : false,
				rockLeftRight: profile.rotateLeftRight ? (state.rotateLeftRight ?? current?.rockLeftRight ?? false) : false,
				rockRound: false,
			},
			logger,
		);
	}

	if (profile.hasHumidity && state.humidityPercent !== undefined) {
		const child = endpoint.getChildEndpointById('HumiditySensor');
		if (child) {
			const measured = Math.min(10000, Math.max(0, Math.round(state.humidityPercent * 100)));
			await child.updateAttribute(RelativeHumidityMeasurement.id, 'measuredValue', measured, logger);
		}
	}

	if (profile.hasFilterInfo && state.filterRemainingPercent !== undefined) {
		await endpoint.updateAttribute(HepaFilterMonitoring.id, 'condition', state.filterRemainingPercent, logger);
		await endpoint.updateAttribute(
			HepaFilterMonitoring.id,
			'changeIndication',
			resolveFilterChangeIndication(state.filterRemainingPercent),
			logger,
		);
	}
}
