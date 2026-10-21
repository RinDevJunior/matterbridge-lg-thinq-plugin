const THINQ_CONNECT_RESULT_CODE_MESSAGES: Readonly<Record<string, string>> = {
	'1103': 'Personal Access Token is invalid or expired. Create a new token.',
	'1218': 'Personal Access Token is invalid or expired. Create a new token.',
	'1202': 'Account is not registered for ThinQ Connect.',
	'1209': 'Account is not registered for ThinQ Connect.',
	'1210': 'Device is not registered for this token.',
	'1211': 'Device is not registered for this token.',
	'1305': 'Token lacks permission (check the Personal Access Token scopes).',
	'1308': 'Token lacks permission (check the Personal Access Token scopes).',
	'1306': 'API call quota exceeded.',
	'1307': 'Country is not supported by the LG ThinQ Connect API.',
	'1222': 'Device is not connected.',
	'1223': 'Device is in an invalid status.',
	'2209': 'Device did not answer in time.',
	'2301': 'Remote control is OFF on the device.',
	'2302': 'Command is not supported in the current state.',
	'2303': 'Command is not supported while the device has an error.',
	'2304': 'Command is not supported while the device is powered off.',
	'2305': 'Command is not supported in the current mode.',
};

export function describeThinqConnectResultCode(code: string | undefined): string | undefined {
	if (code === undefined) {
		return undefined;
	}
	return THINQ_CONNECT_RESULT_CODE_MESSAGES[code];
}
