import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

// Electron names the installed app, and its data folder (%APPDATA%\<name>,
// ~/Library/Application Support/<name>), from productName in the packaged
// package.json. electron-builder's own productName does not put it there,
// so without extraMetadata.productName the installed app ran as
// "xpos-frontend" and shared the development build's data folder and
// single-instance lock.
function extraMetadata(): Record<string, string> {
	const yml = readFileSync(resolve(__dirname, "../electron-builder.yml"), "utf8");
	const lines = yml.split("\n");
	const start = lines.findIndex((l) => l.trim() === "extraMetadata:");
	expect(start, "electron-builder.yml has no extraMetadata block").toBeGreaterThanOrEqual(0);
	const out: Record<string, string> = {};
	for (const line of lines.slice(start + 1)) {
		if (!/^\s+\S/.test(line)) break;
		const m = line.trim().match(/^([\w-]+):\s*(.+)$/);
		if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
	}
	return out;
}

describe("I1: the installed app is called X POS", () => {
	it("names the packaged app X POS, so its data lives under X POS", () => {
		expect(extraMetadata().productName).toBe("X POS");
	});

	it("leaves the development build's name alone, so the two stay separate", () => {
		const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8"));
		expect(pkg.productName).toBeUndefined();
		expect(pkg.name).toBe("xpos-frontend");
	});
});
