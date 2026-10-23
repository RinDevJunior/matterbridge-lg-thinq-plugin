import type { WasherFields } from '../../cli/commands/washerCommon.js';

/** Fake washer model (fixture data only, no network). Mirrors the shape the CLI reads from `modelJsonUri`. */
export function createFakeWasherModel(): Record<string, unknown> {
	return {
		Config: {
			uniProtocol: true,
			defaultCourse: 'NORMAL',
			courseType: 'course',
			smartCourseType: 'SmartCourse',
		},
		ControlWifi: {
			vtCtrl: {
				command: 'Set',
				data: {
					ctrlTarget: ['UNDEFINE'],
					reqDevType: 'PLACEHOLDER',
					productType: 'NORMAL',
					vtData: { UNDEFINE: [] },
				},
			},
			WMDownload: {
				command: 'Set',
				data: {
					dev: {
						Course: 'NORMAL',
						remoteStart: 'REMOTE_START_OFF',
						spin: 'SPIN_1400',
						temp: 'TEMP_40',
					},
				},
			},
		},
		Course: {
			NORMAL: {
				courseType: 'Course',
				function: [
					{ value: 'spin', default: 'SPIN_1400', selectable: ['SPIN_800', 'SPIN_1000', 'SPIN_1200', 'SPIN_1400'] },
					{ value: 'temp', default: 'TEMP_40', selectable: ['TEMP_COLD', 'TEMP_40', 'TEMP_60'] },
					{ value: 'rinse', default: 'RINSE_2', selectable: ['RINSE_1', 'RINSE_2', 'RINSE_3'] },
					{ value: 'soilWash', default: 'SOILWASH_NORMAL', selectable: ['SOILWASH_NORMAL', 'SOILWASH_HEAVY'] },
				],
			},
			COTTON: {
				courseType: 'Course',
				function: [{ value: 'spin', default: 'SPIN_1400', selectable: ['SPIN_1400'] }],
			},
		},
	};
}

/** Builds a `WasherFields` record from plain values, JSON-encoding each one like `readWasherFields` does. Undefined values are omitted. */
export function fieldsOf(record: Record<string, unknown>): WasherFields {
	const fields: WasherFields = {};
	for (const [key, value] of Object.entries(record)) {
		if (value !== undefined) {
			fields[key] = JSON.stringify(value);
		}
	}
	return fields;
}
