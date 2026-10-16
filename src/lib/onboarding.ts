const EXEMPT = ['/onboarding', '/logout', '/api', '/media'];

/**
 * True when a signed-in user must be sent to /onboarding before seeing `pathname`.
 * Driven only by the DB flag; the client-side localStorage hint is never consulted here.
 */
export function needsOnboarding(user: { onboardingCompleted: boolean }, pathname: string): boolean {
	if (user.onboardingCompleted) return false;
	return !EXEMPT.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** The first-run flow is shown without navigation (no sidebar or tab bar). */
export function usesShell(pathname: string): boolean {
	return !(pathname === '/onboarding' || pathname.startsWith('/onboarding/'));
}
