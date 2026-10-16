<script lang="ts">
	import '$lib/styles/fonts.css';
	import '$lib/styles/tokens.css';
	import '$lib/styles/base.css';
	import '$lib/styles/components.css';

	let { children } = $props();
</script>

{@render children()}
