import { json } from '@sveltejs/kit';
import { removeAvatar, setAvatar } from '$lib/server/avatar';
import { getDb } from '$lib/server/db';
import { InvalidImageError, MAX_INPUT_BYTES } from '$lib/server/images';
import { hit } from '$lib/server/ratelimit';
import { checkUploadLength } from '$lib/server/uploadBody';
import type { RequestHandler } from './$types';

function gate(locals: App.Locals): Response | null {
	const user = locals.user;
	if (!user) return json({ error: 'unauthorized' }, { status: 401 });
	if (!user.active) return json({ error: 'forbidden' }, { status: 403 });
	if (!hit(`avatar:${user.id}`, 5, 60_000)) return json({ error: 'rate_limited' }, { status: 429 });
	return null;
}

export const POST: RequestHandler = async ({ locals, request }) => {
	const blocked = gate(locals);
	if (blocked) return blocked;
	const tooBig = checkUploadLength(request);
	if (tooBig) return tooBig;

	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return json({ error: 'bad_request' }, { status: 400 });
	}
	const image = form.get('image');
	if (!(image instanceof File)) return json({ error: 'bad_request' }, { status: 400 });
	if (image.size > MAX_INPUT_BYTES) return json({ error: 'too_large' }, { status: 413 });

	try {
		const file = await setAvatar(getDb(), locals.user!.id, Buffer.from(await image.arrayBuffer()));
		return json({ ok: true, avatar: `/media/${file}` });
	} catch (err) {
		if (err instanceof InvalidImageError) return json({ error: 'invalid_image' }, { status: 422 });
		throw err;
	}
};

export const DELETE: RequestHandler = async ({ locals }) => {
	const blocked = gate(locals);
	if (blocked) return blocked;
	await removeAvatar(getDb(), locals.user!.id);
	return json({ ok: true });
};
