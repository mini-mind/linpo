import { defineConfig } from "@playwright/test";

const baseURL =
	process.env.PLAYWRIGHT_BASE_URL ?? "http://175.178.213.10:5173";

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
