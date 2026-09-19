/**
 * @vitest-environment jsdom
 *
 * ERPNext stores file paths relative to its own site (/private/files/x.jpg).
 * The web POS is served from that site; the desktop app is not, so there the
 * path must point at the ERPNext server.
 */
import { afterEach, describe, expect, it } from "vitest";
import { imageSrc } from "@/utils/imageSrc";
import { setServerUrl } from "@/services/electronBridge";

afterEach(async () => {
	delete (window as { electronAPI?: unknown }).electronAPI;
});

async function onDesktop(serverUrl: string) {
	window.electronAPI = { setServerUrl: async () => undefined } as never;
	await setServerUrl(serverUrl);
}

describe("S1: images point at the ERPNext server", () => {
	it("leaves paths alone in the web POS, which is served from ERPNext", () => {
		expect(imageSrc("/private/files/coca-cola.jpg")).toBe("/private/files/coca-cola.jpg");
	});

	it("points a file path at the ERPNext server on the desktop app", async () => {
		await onDesktop("https://erp.example.com/");
		expect(imageSrc("/private/files/coca-cola.jpg")).toBe(
			"https://erp.example.com/private/files/coca-cola.jpg",
		);
		expect(imageSrc("/files/fanta.jpg")).toBe("https://erp.example.com/files/fanta.jpg");
	});

	it("leaves full URLs and inline images alone", async () => {
		await onDesktop("https://erp.example.com");
		expect(imageSrc("https://cdn.example.net/a.png")).toBe("https://cdn.example.net/a.png");
		expect(imageSrc("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
	});

	it("gives an empty string for no image", () => {
		expect(imageSrc(undefined)).toBe("");
		expect(imageSrc(null)).toBe("");
	});
});
