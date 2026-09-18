import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

// electron-updater reads its feed from the publish block baked in by
// electron-builder. An installed app updates from whatever repository that
// names, so it must be the fork these builds are released from.
function publishConfig(): Record<string, string> {
	const yml = readFileSync(resolve(__dirname, "../electron-builder.yml"), "utf8");
	const lines = yml.split("\n");
	const start = lines.findIndex((l) => l.trim() === "publish:");
	expect(start, "electron-builder.yml has no publish block").toBeGreaterThanOrEqual(0);

	const config: Record<string, string> = {};
	for (const line of lines.slice(start + 1)) {
		if (!/^\s+\S/.test(line)) break;
		const match = line.trim().match(/^([\w-]+):\s*(.+)$/);
		if (match) config[match[1]] = match[2].replace(/^["']|["']$/g, "");
	}
	return config;
}

describe("I2: desktop updates come from the fork's releases", () => {
	it("publishes to GitHub releases on VigesimalTech/xpos", () => {
		expect(publishConfig()).toMatchObject({
			provider: "github",
			owner: "VigesimalTech",
			repo: "xpos",
		});
	});
});
