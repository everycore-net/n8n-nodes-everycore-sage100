import { defineConfig } from 'vitest/config';

export default defineConfig({
	// n8n-workflow ships source maps pointing at files it does not ship, and Vite
	// warns about every one of them, burying the test output.
	logLevel: 'error',
	test: {
		include: ['test/**/*.test.ts'],
	},
});
