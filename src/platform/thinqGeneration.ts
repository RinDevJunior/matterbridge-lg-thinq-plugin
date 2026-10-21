import type { ThinqLoginType } from '../model/LgThinqPluginPlatformConfig.js';

export type ThinqGeneration = 'v1' | 'connect';

/** PAT logins use the official ThinQ Connect API; account/token logins use the legacy EMP API (V1). */
export function resolveThinqGeneration(loginType: ThinqLoginType): ThinqGeneration {
	return loginType === 'pat' ? 'connect' : 'v1';
}
