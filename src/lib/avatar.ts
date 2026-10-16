// Same shape processUpload produces. Anything else (URLs, paths) is never rendered as an image src.
const UPLOAD_NAME = /^[0-9a-f]{32}\.webp$/;

/** `/media/<basename>` for a stored avatar file name, otherwise null. Never echoes user-controlled URLs. */
export function avatarUrl(avatarPath: string | null | undefined): string | null {
	return typeof avatarPath === 'string' && UPLOAD_NAME.test(avatarPath)
		? `/media/${avatarPath}`
		: null;
}
