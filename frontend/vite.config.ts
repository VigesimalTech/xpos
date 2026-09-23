import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";
import { pwaManifest } from "./pwa.manifest";
import { pwaWorkbox } from "./pwa.workbox";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
	base: "/xpos/",
	plugins: [
		vue(),
		VitePWA({
			registerType: "autoUpdate",
			injectRegister: false,
			includeAssets: ["pwa-192x192.svg", "pwa-512x512.svg", "apple-touch-icon.svg"],
			manifest: pwaManifest,
			devOptions: {
				enabled: false,
			},
			workbox: pwaWorkbox,
		}),
	],
	css: {
		postcss: "./postcss.config.js",
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
		},
	},
	server: {
		port: 5174,
		// The user guide is built from ../docs (src/help/guide.ts).
		fs: { allow: [path.resolve(__dirname, "..")] },
		middlewareMode: false,
		proxy: {
			"/api": {
				target: "http://localhost:8000",
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/api/, "/api"),
				configure: (proxy) => {
					proxy.on("proxyReq", (_proxyReq, req) => {
						console.log("Request:", req.method, req.url);
					});
				},
			},
			"/method": {
				target: "http://localhost:8000",
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/method/, "/method"),
			},
			"/assets": {
				target: "http://localhost:8000",
				changeOrigin: true,
			},
			"/files": {
				target: "http://localhost:8000",
				changeOrigin: true,
			},
			"/upload_file": {
				target: "http://localhost:8000",
				changeOrigin: true,
			},
			"/api/resource": {
				target: "http://localhost:8000",
				changeOrigin: true,
			},
			"/socket.io": {
				target: "http://localhost:9000",
				changeOrigin: true,
				ws: true,
				rewrite: (path) => path.replace(/^\/socket.io/, "/socket.io"),
			},
		},
	},
	optimizeDeps: {
		exclude: ["@vite/client", "@vite/env"],
	},
	build: {
		outDir: path.resolve(__dirname, "../xpos/public/xpos"),
		emptyOutDir: true,
		sourcemap: true,
		rollupOptions: {
			input: path.resolve(__dirname, "index.html"),
			output: {
				manualChunks(id) {
					if (!id.includes("node_modules")) return;

					if (
						id.includes("node_modules/vue") ||
						id.includes("node_modules/vue-router") ||
						id.includes("node_modules/pinia")
					) {
						return "vendor-vue";
					}

					const parts = id.split("node_modules/")[1]?.split("/") || [];
					const pkgName = parts[0]?.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
					if (pkgName) return `vendor-${pkgName.replace("/", "-")}`;
				},
			},
		},
	},
});
