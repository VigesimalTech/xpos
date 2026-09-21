/**
 * @vitest-environment jsdom
 *
 * Return Invoice, Repeat Invoice and the panel of unsynced sales open by event from the
 * menus, shortcuts, search and the sync pill. They lived in the web POS's navbar, which
 * the desktop till does not show, so on the till none of them opened (bug hunt).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

const pos = vi.hoisted(() => ({ allowReturn: true }));
const may = vi.hoisted(() => ({ sale_return: true }));
vi.mock("@/stores/posStore", () => ({ usePosStore: () => pos }));
vi.mock("@/services/userRights", () => ({ canDoOrAsk: (k: "sale_return") => may[k] }));

import SaleDialogs from "@/components/SaleDialogs.vue";

const stub = (name: string) => ({
	name,
	props: ["open"],
	template: `<div v-if="open" data-open="${name}" />`,
});
const stubs = {
	ReturnDialog: stub("return"),
	RepeatInvoiceDialog: stub("repeat"),
	OfflinePendingPanel: stub("pending"),
};

async function send(event: string) {
	window.dispatchEvent(new CustomEvent(event));
	await flushPromises();
}

beforeEach(() => {
	pos.allowReturn = true;
	may.sale_return = true;
});

describe("the sale dialogs, on the till as on the web", () => {
	it("each event opens its dialog", async () => {
		const w = mount(SaleDialogs, { global: { stubs } });
		await send("xpos:show-repeat-dialog");
		await send("xpos:show-return-dialog");
		await send("xpos:open-offline-panel");
		expect(w.findAll("[data-open]").map((e) => e.attributes("data-open"))).toEqual([
			"return",
			"repeat",
			"pending",
		]);
		w.unmount();
	});

	it("Return opens only where the profile allows returns and the cashier may do or ask", async () => {
		pos.allowReturn = false;
		const w = mount(SaleDialogs, { global: { stubs } });
		await send("xpos:show-return-dialog");
		expect(w.find('[data-open="return"]').exists()).toBe(false);
		w.unmount();
	});

	it("stops listening when it goes", async () => {
		const w = mount(SaleDialogs, { global: { stubs } });
		w.unmount();
		await send("xpos:show-repeat-dialog");
		expect(document.querySelector("[data-open]")).toBeNull();
	});
});
