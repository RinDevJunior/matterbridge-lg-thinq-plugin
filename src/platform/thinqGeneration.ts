import type { ThinqLoginType } from '../model/LgThinqPluginPlatformConfig.js';

export type ThinqGeneration = 'v1' | 'v2';

/** PAT logins use the official ThinQ Connect API (v2); account/token logins use the EMP API (v1). */
export function resolveThinqGeneration(loginType: ThinqLoginType): ThinqGeneration {
	return loginType === 'pat' ? 'v2' : 'v1';
}
