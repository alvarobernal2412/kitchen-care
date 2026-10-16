export type ErrorCopy = { title: string; text: string; offerLogin: boolean };

/** Fixed copy per HTTP status for the error page. Never built from the error's own message. */
export function errorCopy(status: number): ErrorCopy {
	if (status === 404) {
		return {
			title: "This page doesn't exist",
			text: 'The link may be old or mistyped. Home has everything.',
			offerLogin: false
		};
	}
	if (status === 403) {
		return {
			title: "You don't have access to this page.",
			text: 'It is meant for admins. Home has everything else.',
			offerLogin: false
		};
	}
	if (status === 401) {
		return {
			title: 'Please log in',
			text: 'You need to be logged in to see this page.',
			offerLogin: true
		};
	}
	if (status === 429) {
		return {
			title: 'Too many attempts',
			text: 'Wait a few minutes and try again.',
			offerLogin: false
		};
	}
	if (status >= 500) {
		return {
			title: 'Something went wrong on our side. Try again in a moment.',
			text: 'Your credits are safe. If it keeps happening, tell an admin.',
			offerLogin: false
		};
	}
	return {
		title: "That request didn't work",
		text: 'Check the address and try again.',
		offerLogin: false
	};
}
