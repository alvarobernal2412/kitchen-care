<script lang="ts">
	import { resolve } from '$app/paths';
</script>

<svelte:head><title>Privacy notice</title></svelte:head>

<main class="privacy">
	<p class="back"><a href={resolve('/')}>← Back to Kitchen Care Credits</a></p>
	<h1>Privacy notice</h1>
	<p class="lead">
		Kitchen Care Credits is a small office tool that awards points for kitchen chores. This page says what
		it stores about you and what you can do about it.
	</p>

	<h2>What we store</h2>
	<ul>
		<li>Your username, a hash of your password (never the password itself), and whether you are a student or an employee, plus your department if you are an employee.</li>
		<li>Your optional profile photo.</li>
		<li>The chores you log, with their points, status and time. Some chores need a proof photo; it is kept until an admin deletes the photos of a period, or you delete your account.</li>
		<li>Posts, comments and reactions you write in the feed.</li>
		<li>A sign-in cookie and a few simple counts of when you open the app (used for the admin’s usage charts).</li>
		<li>Your IP address appears in the web server’s technical logs, which we keep only for security and troubleshooting.</li>
	</ul>

	<h2>Why, and on what basis</h2>
	<p>
		To run the points programme you chose to join: to credit your chores, rank the leaderboard and show the
		community feed. The legal basis is our legitimate interest in running it (GDPR Art. 6(1)(f)), and your
		sign-up. We do not sell data, show ads or use third-party trackers.
	</p>

	<h2>Cookies and local storage</h2>
	<p>
		We use one cookie to keep you signed in (essential, expires after 90 days or when you sign out) and one to
		remember whether the sidebar is open. Your browser also keeps two small notes (whether you finished the
		welcome tour and when you last saw the install hint). None of them tracks you, so there is no cookie banner.
	</p>

	<h2>Who sees it</h2>
	<p>
		Other signed-in members see your username, photo, department, posts, comments and leaderboard points.
		Admins also see your chore history and proof photos. The data is stored on our own server.
	</p>
	<p>
		The cutlery check runs in your browser: your camera image is never uploaded for it. Its detection model is
		downloaded from Google Cloud Storage the first time you use it, so Google receives your IP address then.
	</p>

	<h2>How long we keep it</h2>
	<p>
		Until you delete your account. Proof photos can also be removed earlier by an admin when a period ends.
		Server logs are size-capped, so old entries are overwritten within days to weeks.
	</p>

	<h2>Your rights</h2>
	<p>
		You can see and download your data, correct your username, and delete your account yourself under
		<a href={resolve('/profile')}>Profile → Your data</a>. Deleting removes your photo, posts, comments,
		reactions and sessions; your points remain in past results without your name. You can also ask us to
		restrict or object to processing, or complain to your data protection authority.
	</p>

	<h2>Contact</h2>
	<p>Ask the administrators of this site.</p>
</main>

<style>
	.privacy {
		max-width: 40rem;
		margin: 0 auto;
		padding: var(--sp-7) var(--gutter) var(--sp-8);
	}
	.back {
		margin-bottom: var(--sp-5);
	}
	h2 {
		margin-top: var(--sp-6);
	}
	.lead {
		margin-top: var(--sp-2);
		color: var(--muted);
	}
	ul {
		padding-left: 1.25rem;
	}
	li,
	p {
		margin-top: var(--sp-2);
	}
</style>
