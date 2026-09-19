/**
 * @vitest-environment jsdom
 *
 * Which invoice doctype the app lists and prints. The web POS reads it from window.xpos.boot;
 * the desktop app has no boot and must take it from the ERP settings it fetches, or Order
 * History asks ERPNext for no doctype and shows nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";

vi.mock("@/services/api", () => ({ call: vi.fn(), default: { call: vi.fn() } }));
vi.mock("@/services/electronBridge", () => ({ isElectron: () => true }));
vi.mock("@/utils", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/utils")>()),
	isOnline: () => true,
}));

import { call } from "@/services/api";
import { usePosStore } from "@/stores/posStore";
import { useSettingsStore } from "@/stores/settingsStore";

describe("the invoice doctype on the desktop app", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		vi.mocked(call).mockReset();
		(window as unknown as { xpos?: unknown }).xpos = {};
	});

	it("comes from the ERP settings, as there is no boot", async () => {
		vi.mocked(call).mockResolvedValue({ pos_settings: { invoice_type: "POS Invoice" } });

		await useSettingsStore().fetchSettings();

		expect(call).toHaveBeenCalledWith("xpos.api.settings.get_erp_settings");
		expect(usePosStore().invoiceType).toBe("POS Invoice");
	});

	it("is Sales Invoice, ERPNext's default, before the settings arrive", () => {
		expect(usePosStore().invoiceType).toBe("Sales Invoice");
	});
});
