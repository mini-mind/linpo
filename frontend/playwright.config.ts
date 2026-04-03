import { defineConfig } from "@playwright/test";

const baseURL =
	process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173";

export default defineConfig({
	testDir: "./e2e",
	timeout: 90_000,
	expect: {
		timeout: 15_000,
	},
	fullyParallel: false,
	workers: 1,
	reporter: "list",
	use: {
		baseURL,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
	},
});
