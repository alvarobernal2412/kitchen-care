import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({
	// Who users contact about their data. Set PRIVACY_CONTACT (an email address or a short sentence).
	contact: env.PRIVACY_CONTACT?.trim() || null
});
