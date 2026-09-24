import { MatterbridgeEndpoint } from 'matterbridge';
import { AnsiLogger } from 'matterbridge/logger';
import { FanControl, Thermostat } from 'matterbridge/matter/clusters';
import { isValidNumber } from 'matterbridge/utils';

import type { ThinqAirConditionerDevice } from '../../core/domain/entities/ThinqDevice.js';
import type { AirConditionerCapabilities } from '../../core/domain/value-objects/AirConditionerCapabilities.js';
import { ThinqApiClient } from '../../services/thinq/thinqApiClient.js';

/** LG `airState.windStrength` values (`homebridge-lg-thinq/src/devices/AirConditioner.ts:15,19-25`). */
export const THINQ_FAN_SPEED_AUTO = 8;
export const THINQ_FAN_SPEED_LOW = 2;
export const THINQ_FAN_SPEED_MEDIUM = 4;
export const THINQ_FAN_SPEED_HIGH = 6;

const THINQ_OPERATION_ON = 1;
const THINQ_OPERATION_OFF = 0;

/** LG ACs commonly step Celsius setpoints by half a degree; snapping to this avoids ThinQ 400s on off-step values. */
const THINQ_TEMPERATURE_STEP_CELSIUS = 0.5;

function withErrorHandling(commandName: string, logger: AnsiLogger, handler: () => Promise<void>): () => Promise<void> {
	return async () => {
		try {
			await handler();
		} catch (error) {
			logger.error(
				`ThinQ AirConditioner command '${commandName}' failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			throw error;
		}
	};
}

/** Rounds a Celsius value to the nearest multiple of `step` (e.g. 25.3 -> 25.5 for step 0.5). */
function roundToStep(value: number, step: number): number {
	return Math.round(value / step) * step;
}

/**
 * Reverts a Thermostat setpoint attribute back to `oldValue` after a failed ThinQ command, so Apple Home
 * self-corrects immediately instead of showing a value ThinQ never accepted. Best-effort: `updateAttribute`
 * failures are swallowed since the original command failure is already logged by `withErrorHandling`.
 */
function revertSetpointOnFailure(
	airConditioner: MatterbridgeEndpoint,
	attribute: 'occupiedCoolingSetpoint' | 'occupiedHeatingSetpoint',
	oldValue: number,
): () => void {
	return () => {
		airConditioner.updateAttribute(Thermostat.id, attribute, oldValue, airConditioner.log).catch(() => {
			// Best-effort revert; original failure already logged inside withErrorHandling.
		});
	};
}

function mapPercentToWindStrength(percent: number): number | undefined {
	if (percent === 0) {
		return undefined;
	}
	if (percent <= 33) {
		return THINQ_FAN_SPEED_LOW;
	}
	if (percent <= 66) {
		return THINQ_FAN_SPEED_MEDIUM;
	}
	return THINQ_FAN_SPEED_HIGH;
}

function mapFanModeToWindStrength(fanMode: FanControl.FanMode): number | undefined {
	switch (fanMode) {
		case FanControl.FanMode.Auto:
			return THINQ_FAN_SPEED_AUTO;
		case FanControl.FanMode.Low:
			return THINQ_FAN_SPEED_LOW;
		case FanControl.FanMode.Medium:
			return THINQ_FAN_SPEED_MEDIUM;
		case FanControl.FanMode.High:
			return THINQ_FAN_SPEED_HIGH;
		default:
			return undefined;
	}
}

/**
 * Registers Apple Home → ThinQ command handlers on an already-constructed `AirConditioner` endpoint.
 * `OnOff.on`/`off` and `subscribeAttribute` for setpoints/fan speed all forward to `ThinqApiClient.sendCommand`.
 */
export function registerAirConditionerCommandHandlers(
	airConditioner: MatterbridgeEndpoint,
	device: ThinqAirConditionerDevice,
	apiClient: ThinqApiClient,
	logger: AnsiLogger,
	capabilities: AirConditionerCapabilities,
): void {
	airConditioner.addCommandHandler(
		'on',
		withErrorHandling('on', logger, async () => {
			logger.debug(
				`ThinQ AirConditioner ${device.id}: 'on' command handler invoked, capabilities=${JSON.stringify(capabilities)}`,
			);
			await apiClient.sendCommand(device.id, {
				command: 'Operation',
				dataKey: 'airState.operation',
				dataValue: THINQ_OPERATION_ON,
			});
		}),
	);

	airConditioner.addCommandHandler(
		'off',
		withErrorHandling('off', logger, async () => {
			logger.debug(
				`ThinQ AirConditioner ${device.id}: 'off' command handler invoked, capabilities=${JSON.stringify(capabilities)}`,
			);
			await apiClient.sendCommand(device.id, {
				command: 'Operation',
				dataKey: 'airState.operation',
				dataValue: THINQ_OPERATION_OFF,
			});
		}),
	);

	airConditioner.subscribeAttribute(
		Thermostat.id,
		'occupiedCoolingSetpoint',
		(newValue: number, oldValue: number, context) => {
			if (context.fabric === undefined) {
				return;
			}
			logger.debug(
				`ThinQ AirConditioner ${device.id}: 'occupiedCoolingSetpoint' command handler invoked, newValue=${newValue}, capabilities=${JSON.stringify(capabilities)}`,
			);
			void withErrorHandling('occupiedCoolingSetpoint', logger, async () => {
				await apiClient.sendCommand(device.id, {
					dataKey: 'airState.tempState.target',
					dataValue: roundToStep(newValue / 100, THINQ_TEMPERATURE_STEP_CELSIUS),
				});
			})().catch(revertSetpointOnFailure(airConditioner, 'occupiedCoolingSetpoint', oldValue));
		},
		airConditioner.log,
	);

	if (capabilities.supportsHeat) {
		airConditioner.subscribeAttribute(
			Thermostat.id,
			'occupiedHeatingSetpoint',
			(newValue: number, oldValue: number, context) => {
				if (context.fabric === undefined) {
					return;
				}
				logger.debug(
					`ThinQ AirConditioner ${device.id}: 'occupiedHeatingSetpoint' command handler invoked, newValue=${newValue}, capabilities=${JSON.stringify(capabilities)}`,
				);
				void withErrorHandling('occupiedHeatingSetpoint', logger, async () => {
					await apiClient.sendCommand(device.id, {
						dataKey: 'airState.tempState.target',
						dataValue: roundToStep(newValue / 100, THINQ_TEMPERATURE_STEP_CELSIUS),
					});
				})().catch(revertSetpointOnFailure(airConditioner, 'occupiedHeatingSetpoint', oldValue));
			},
			airConditioner.log,
		);
	}

	airConditioner.subscribeAttribute(
		FanControl,
		'percentSetting',
		(newValue, _oldValue, context) => {
			if (context.fabric === undefined) {
				return;
			}
			logger.debug(
				`ThinQ AirConditioner ${device.id}: 'percentSetting' command handler invoked, newValue=${newValue}, capabilities=${JSON.stringify(capabilities)}`,
			);
			if (!capabilities.supportsFanSpeedControl) {
				logger.debug(
					`ThinQ AirConditioner ${device.id}: ignoring percentSetting change — fan speed control not supported per configured capabilities.`,
				);
				return;
			}
			if (newValue === null || !isValidNumber(newValue, 0, 100)) {
				return;
			}
			const windStrength = mapPercentToWindStrength(newValue);
			if (windStrength === undefined) {
				logger.debug(`ThinQ AirConditioner ${device.id}: ignoring percentSetting=0 (ambiguous, no ThinQ equivalent).`);
				return;
			}
			void withErrorHandling('percentSetting', logger, async () => {
				await apiClient.sendCommand(device.id, {
					dataKey: 'airState.windStrength',
					dataValue: windStrength,
				});
			})();
		},
		airConditioner.log,
	);

	airConditioner.subscribeAttribute(
		FanControl,
		'fanMode',
		(newValue: FanControl.FanMode, _oldValue: FanControl.FanMode, context) => {
			if (context.fabric === undefined) {
				return;
			}
			logger.debug(
				`ThinQ AirConditioner ${device.id}: 'fanMode' command handler invoked, newValue=${FanControl.FanMode[newValue]}, capabilities=${JSON.stringify(capabilities)}`,
			);
			if (!capabilities.supportsFanSpeedControl) {
				logger.debug(
					`ThinQ AirConditioner ${device.id}: ignoring fanMode change — fan speed control not supported per configured capabilities.`,
				);
				return;
			}
			const windStrength = mapFanModeToWindStrength(newValue);
			if (windStrength === undefined) {
				logger.debug(
					`ThinQ AirConditioner ${device.id}: ignoring fanMode=${FanControl.FanMode[newValue]} (no ThinQ equivalent).`,
				);
				return;
			}
			void withErrorHandling('fanMode', logger, async () => {
				await apiClient.sendCommand(device.id, {
					dataKey: 'airState.windStrength',
					dataValue: windStrength,
				});
			})();
		},
		airConditioner.log,
	);

	if (capabilities.supportsSwingMode) {
		airConditioner.subscribeAttribute(
			FanControl,
			'rockSetting',
			(newValue: unknown, oldValue: unknown, context) => {
				if (context.fabric === undefined) {
					return;
				}

				const newRock = newValue as Record<string, boolean> | undefined;
				const oldRock = oldValue as Record<string, boolean> | undefined;

				logger.debug(
					`ThinQ AirConditioner ${device.id}: 'rockSetting' command handler invoked, newValue=${JSON.stringify(newRock)}, capabilities=${JSON.stringify(capabilities)}`,
				);

				if (!newRock || !oldRock) {
					return;
				}

				const verticalChanged = newRock.rockUpDown !== oldRock.rockUpDown;
				const horizontalChanged = newRock.rockLeftRight !== oldRock.rockLeftRight;

				if (!verticalChanged && !horizontalChanged) {
					return;
				}

				void withErrorHandling('rockSetting', logger, async () => {
					if (verticalChanged && horizontalChanged && newRock.rockUpDown && newRock.rockLeftRight) {
						await apiClient.sendCommand(device.id, {
							dataKey: null,
							dataValue: null,
							command: 'Set',
							ctrlKey: 'favoriteCtrl',
							dataSetList: {
								'airState.wDir.vStep': '100',
								'airState.wDir.hStep': '100',
							},
						});
					} else {
						if (verticalChanged) {
							await apiClient.sendCommand(device.id, {
								dataKey: 'airState.wDir.vStep',
								dataValue: newRock.rockUpDown ? '100' : '0',
							});
						}
						if (horizontalChanged) {
							await apiClient.sendCommand(device.id, {
								dataKey: 'airState.wDir.hStep',
								dataValue: newRock.rockLeftRight ? '100' : '0',
							});
						}
					}
				})();
			},
			airConditioner.log,
		);
	}
}
