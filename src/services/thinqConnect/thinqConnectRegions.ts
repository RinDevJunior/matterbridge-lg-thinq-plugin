import { ThinqConnectApiError } from '../../errors/index.js';

export type ThinqConnectRegion = 'kic' | 'aic' | 'eic';

const REGION_COUNTRIES: Record<ThinqConnectRegion, string> = {
	kic: 'AU BD CN HK ID IN JP KH KR LA LK MM MY NP NZ PH SG TH TW VN',
	aic: 'AG AR AW BB BO BR BS BZ CA CL CO CR CU DM DO EC GD GT GY HN HT JM KN LC MX NI PA PE PR PY SR SV TT US UY VC VE',
	eic: 'AE AF AL AM AO AT AZ BA BE BF BG BH BJ BY CD CF CG CH CI CM CV CY CZ DE DJ DK DZ EE EG ES ET FI FR GA GB GE GH GM GN GQ GR HR HU IE IL IQ IR IS IT JO KE KG KW KZ LB LR LT LU LV LY MA MD ME MK ML MR MT MU MW NE NG NL NO OM PK PL PS PT QA RO RS RU RW SA SD SE SI SK SL SN SO ST SY TD TG TN TR TZ UA UG UZ XK YE ZA ZM',
};

const COUNTRY_TO_REGION = new Map<string, ThinqConnectRegion>(
	(Object.keys(REGION_COUNTRIES) as ThinqConnectRegion[]).flatMap((region) =>
		REGION_COUNTRIES[region].split(' ').map((country): [string, ThinqConnectRegion] => [country, region]),
	),
);

export function resolveThinqConnectRegion(country: string): ThinqConnectRegion | undefined {
	return COUNTRY_TO_REGION.get(country.trim().toUpperCase());
}

export function getThinqConnectBaseUrl(country: string): string {
	const region = resolveThinqConnectRegion(country);
	if (!region) {
		throw new ThinqConnectApiError(`Country "${country}" is not supported by the LG ThinQ Connect API`, '1307');
	}
	return `https://api-${region}.lgthinq.com`;
}
