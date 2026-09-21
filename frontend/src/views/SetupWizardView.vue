<template>
	<div
		class="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-background to-muted p-4"
	>
		<div class="mb-6 text-center">
			<div class="w-16 h-16 mx-auto mb-4 rounded-2xl bg-primary flex items-center justify-center">
				<Store class="w-8 h-8 text-primary-foreground" />
			</div>
			<h1 class="text-2xl font-bold text-foreground">X POS</h1>
			<p class="text-muted-foreground text-sm mt-1">Initial Setup</p>
		</div>

		<div class="flex items-center gap-2 mb-6">
			<template v-for="s in totalSteps" :key="s">
				<div
					:class="[
						'w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-colors',
						s < step
							? 'bg-primary text-primary-foreground'
							: s === step
								? 'bg-primary text-primary-foreground ring-2 ring-primary/30'
								: 'bg-muted text-muted-foreground',
					]"
				>
					<Check v-if="s < step" class="w-4 h-4" />
					<span v-else>{{ s }}</span>
				</div>
				<div v-if="s < totalSteps" class="w-8 h-0.5" :class="s < step ? 'bg-primary' : 'bg-border'" />
			</template>
		</div>

		<Card class="w-full max-w-lg">
			<template v-if="step === 1">
				<CardHeader class="text-center">
					<CardTitle>Select Installation Type</CardTitle>
					<CardDescription>Choose how this machine will be used</CardDescription>
				</CardHeader>
				<CardContent class="space-y-3">
					<button
						@click="config.role = 'hub'"
						:class="[
							'w-full p-4 rounded-lg border-2 text-start transition-all',
							config.role === 'hub'
								? 'border-primary bg-primary/5'
								: 'border-border hover:border-primary/50',
						]"
					>
						<div class="flex items-start gap-3">
							<div
								class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"
							>
								<Server class="w-5 h-5 text-primary" />
							</div>
							<div>
								<p class="font-semibold text-foreground">Hub (Server)</p>
								<p class="text-sm text-muted-foreground mt-0.5">
									Main server that syncs with ERPNext and serves data to all tills on the
									network. Install on one machine per location.
								</p>
							</div>
						</div>
					</button>
					<button
						@click="config.role = 'till'"
						:class="[
							'w-full p-4 rounded-lg border-2 text-start transition-all',
							config.role === 'till'
								? 'border-primary bg-primary/5'
								: 'border-border hover:border-primary/50',
						]"
					>
						<div class="flex items-start gap-3">
							<div
								class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"
							>
								<MonitorSmartphone class="w-5 h-5 text-primary" />
							</div>
							<div>
								<p class="font-semibold text-foreground">Till (Client)</p>
								<p class="text-sm text-muted-foreground mt-0.5">
									Point of sale terminal that connects to the hub server on the local
									network. Install on each checkout counter.
								</p>
							</div>
						</div>
					</button>
				</CardContent>
				<CardFooter class="justify-end">
					<Button @click="step = 2" :disabled="!config.role">
						Next
						<ChevronRight class="w-4 h-4 ms-1" />
					</Button>
				</CardFooter>
			</template>

			<template v-if="step === 2">
				<CardHeader>
					<CardTitle>Database Configuration</CardTitle>
					<CardDescription>Configure connection to local MariaDB</CardDescription>
				</CardHeader>
				<CardContent>
					<div
						v-if="mariaDbStatus !== null"
						class="mb-4 p-3 rounded-lg border"
						:class="
							mariaDbStatus.installed
								? 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800'
								: 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800'
						"
					>
						<div class="flex items-start gap-2">
							<CircleCheck
								v-if="mariaDbStatus.installed"
								class="w-5 h-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5"
							/>
							<AlertTriangle
								v-else
								class="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
							/>
							<div class="text-sm">
								<p
									v-if="mariaDbStatus.installed"
									class="font-medium text-green-800 dark:text-green-300"
								>
									MariaDB detected: {{ mariaDbStatus.version }}
								</p>
								<template v-else>
									<p class="font-medium text-amber-800 dark:text-amber-300">
										MariaDB not detected
									</p>
									<p class="text-amber-700 dark:text-amber-400 mt-1">
										Install MariaDB before proceeding:
									</p>
									<div
										class="mt-2 p-2 rounded bg-background/80 font-mono text-xs leading-relaxed select-all"
									>
										<template v-if="platformInfo === 'win32'">
											Download installer from:<br />
											https://mariadb.org/download/<br /><br />
											Or via winget:<br />
											winget install MariaDB.Server
										</template>
										<template v-else-if="platformInfo === 'darwin'">
											brew install mariadb<br />
											brew services start mariadb
										</template>
										<template v-else>
											sudo apt install mariadb-server<br />
											sudo systemctl start mariadb<br />
											sudo mysql_secure_installation
										</template>
									</div>
									<Button
										size="sm"
										variant="ghost"
										class="mt-2 text-amber-700 dark:text-amber-400"
										@click="detectMariaDb"
									>
										<RefreshCw class="w-3.5 h-3.5 me-1" />
										Re-check
									</Button>
								</template>
							</div>
						</div>
					</div>

					<div class="grid grid-cols-2 gap-3">
						<div>
							<label class="text-sm font-medium text-foreground">Host</label>
							<Input v-model="config.dbHost" placeholder="127.0.0.1" class="mt-1" />
						</div>
						<div>
							<label class="text-sm font-medium text-foreground">Port</label>
							<Input
								v-model.number="config.dbPort"
								type="number"
								placeholder="3306"
								class="mt-1"
							/>
						</div>
						<div>
							<label class="text-sm font-medium text-foreground">Username</label>
							<Input v-model="config.dbUser" placeholder="xpos" class="mt-1" />
						</div>
						<div>
							<label class="text-sm font-medium text-foreground">Password</label>
							<Input
								v-model="config.dbPassword"
								type="password"
								placeholder="••••••"
								class="mt-1"
							/>
						</div>
						<div class="col-span-2">
							<label class="text-sm font-medium text-foreground">Database Name</label>
							<Input v-model="config.dbName" placeholder="xpos_local" class="mt-1" />
						</div>
					</div>
					<div class="mt-3">
						<Button size="sm" variant="outline" @click="testDb" :disabled="testingDb">
							<Loader2 v-if="testingDb" class="w-4 h-4 me-1 animate-spin" />
							<DatabaseZap v-else class="w-4 h-4 me-1" />
							Test Connection
						</Button>
						<span
							v-if="dbTestResult !== null"
							:class="['text-sm ms-2', dbTestResult ? 'text-green-600' : 'text-destructive']"
						>
							{{ dbTestResult ? "Connected!" : dbTestError }}
						</span>
					</div>
				</CardContent>
				<CardFooter class="justify-between">
					<Button variant="outline" @click="step = 1">
						<ChevronLeft class="w-4 h-4 me-1" />
						Back
					</Button>
					<Button @click="step = 3" :disabled="!dbTestResult">
						Next
						<ChevronRight class="w-4 h-4 ms-1" />
					</Button>
				</CardFooter>
			</template>

			<template v-if="step === 3">
				<CardHeader>
					<CardTitle>{{ config.role === "hub" ? "ERPNext Server" : "Hub Server" }}</CardTitle>
					<CardDescription>
						{{
							config.role === "hub"
								? "Connect to your live ERPNext instance for data synchronization"
								: "Connect to the hub server on your local network"
						}}
					</CardDescription>
				</CardHeader>
				<CardContent class="space-y-3">
					<template v-if="config.role === 'hub'">
						<div>
							<label class="text-sm font-medium text-foreground">ERPNext URL</label>
							<Input
								v-model="config.erpUrl"
								placeholder="https://erp.example.com"
								class="mt-1"
							/>
						</div>
						<div>
							<label class="text-sm font-medium text-foreground">API Key</label>
							<Input v-model="config.apiKey" placeholder="API Key" class="mt-1" />
						</div>
						<div>
							<label class="text-sm font-medium text-foreground">API Secret</label>
							<Input
								v-model="config.apiSecret"
								type="password"
								placeholder="API Secret"
								class="mt-1"
							/>
						</div>
						<div>
							<label class="text-sm font-medium text-foreground">Hub API Port</label>
							<Input
								v-model.number="config.hubApiPort"
								type="number"
								placeholder="6789"
								class="mt-1 w-32"
							/>
							<p class="text-xs text-muted-foreground mt-1">
								Port for till clients to connect to this hub
							</p>
						</div>
						<div>
							<Button size="sm" variant="outline" @click="testErpNext" :disabled="testingErp">
								<Loader2 v-if="testingErp" class="w-4 h-4 me-1 animate-spin" />
								<Globe v-else class="w-4 h-4 me-1" />
								Test ERPNext Connection
							</Button>
							<span
								v-if="erpTestResult !== null"
								:class="[
									'text-sm ms-2',
									erpTestResult ? 'text-green-600' : 'text-destructive',
								]"
							>
								{{ erpTestResult ? "Connected!" : erpTestError }}
							</span>
						</div>
					</template>
					<template v-else>
						<div>
							<label class="text-sm font-medium text-foreground">Hub Server URL</label>
							<Input
								v-model="config.hubUrl"
								placeholder="http://192.168.1.100:6789"
								class="mt-1"
							/>
							<p class="text-xs text-muted-foreground mt-1">
								IP address and port of the hub server on your local network
							</p>
						</div>
						<div>
							<label class="text-sm font-medium text-foreground">Till ID</label>
							<Input v-model="config.tillId" placeholder="TILL-01" class="mt-1 w-48" />
							<p class="text-xs text-muted-foreground mt-1">Unique identifier for this till</p>
						</div>
						<div>
							<Button size="sm" variant="outline" @click="pingHub" :disabled="testingHub">
								<Loader2 v-if="testingHub" class="w-4 h-4 me-1 animate-spin" />
								<Wifi v-else class="w-4 h-4 me-1" />
								Ping Hub
							</Button>
							<span
								v-if="hubTestResult !== null"
								:class="[
									'text-sm ms-2',
									hubTestResult ? 'text-green-600' : 'text-destructive',
								]"
							>
								{{ hubTestResult ? "Hub reachable!" : "Hub unreachable" }}
							</span>
						</div>
					</template>
				</CardContent>
				<CardFooter class="justify-between">
					<Button variant="outline" @click="step = 2">
						<ChevronLeft class="w-4 h-4 me-1" />
						Back
					</Button>
					<Button @click="step = 4" :disabled="!canProceedStep3">
						Next
						<ChevronRight class="w-4 h-4 ms-1" />
					</Button>
				</CardFooter>
			</template>

			<template v-if="step === 4">
				<CardHeader>
					<CardTitle>Setup Summary</CardTitle>
					<CardDescription> Review your configuration before completing setup </CardDescription>
				</CardHeader>
				<CardContent>
					<div class="space-y-3 text-sm">
						<div class="flex items-center justify-between p-3 rounded-lg bg-muted">
							<span class="text-muted-foreground">Installation Type</span>
							<Badge variant="default">{{
								config.role === "hub" ? "Hub (Server)" : "Till (Client)"
							}}</Badge>
						</div>
						<div class="flex items-center justify-between p-3 rounded-lg bg-muted">
							<span class="text-muted-foreground">Database</span>
							<span class="text-foreground font-medium"
								>{{ config.dbUser }}@{{ config.dbHost }}:{{ config.dbPort }}/{{
									config.dbName
								}}</span
							>
						</div>
						<div
							v-if="config.role === 'hub'"
							class="flex items-center justify-between p-3 rounded-lg bg-muted"
						>
							<span class="text-muted-foreground">ERPNext Server</span>
							<span class="text-foreground font-medium">{{ config.erpUrl }}</span>
						</div>
						<div
							v-if="config.role === 'hub'"
							class="flex items-center justify-between p-3 rounded-lg bg-muted"
						>
							<span class="text-muted-foreground">Hub API Port</span>
							<span class="text-foreground font-medium">{{ config.hubApiPort }}</span>
						</div>
						<div
							v-if="config.role === 'till'"
							class="flex items-center justify-between p-3 rounded-lg bg-muted"
						>
							<span class="text-muted-foreground">Hub Server</span>
							<span class="text-foreground font-medium">{{ config.hubUrl }}</span>
						</div>
						<div
							v-if="config.role === 'till'"
							class="flex items-center justify-between p-3 rounded-lg bg-muted"
						>
							<span class="text-muted-foreground">Till ID</span>
							<span class="text-foreground font-medium">{{ config.tillId }}</span>
						</div>
					</div>
				</CardContent>
				<CardFooter class="justify-between">
					<Button variant="outline" @click="step = 3">
						<ChevronLeft class="w-4 h-4 me-1" />
						Back
					</Button>
					<Button @click="completeSetup" :disabled="completing">
						<Loader2 v-if="completing" class="w-4 h-4 me-1 animate-spin" />
						<Check v-else class="w-4 h-4 me-1" />
						Complete Setup
					</Button>
				</CardFooter>
			</template>
		</Card>

		<div
			v-if="setupError"
			class="mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm max-w-lg w-full"
		>
			{{ setupError }}
		</div>
	</div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from "vue";
import { useRouter } from "vue-router";
import { toast } from "vue-sonner";
import { markSetupComplete } from "@/router/setupGuard";
import { setServerUrl, warmApiCredentials } from "@/services/electronBridge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
	Store,
	Server,
	MonitorSmartphone,
	ChevronRight,
	ChevronLeft,
	Check,
	Loader2,
	Globe,
	Wifi,
	DatabaseZap,
	CircleCheck,
	AlertTriangle,
	RefreshCw,
} from "lucide-vue-next";

const router = useRouter();

const step = ref(1);
const totalSteps = 4;

const config = reactive({
	role: "" as "" | "hub" | "till",
	dbHost: "127.0.0.1",
	dbPort: 3306,
	dbUser: "xpos",
	dbPassword: "xpos",
	dbName: "xpos_local",
	erpUrl: "",
	apiKey: "",
	apiSecret: "",
	hubApiPort: 6789,
	hubUrl: "",
	tillId: "TILL-01",
});

const testingDb = ref(false);
const dbTestResult = ref<boolean | null>(null);
const dbTestError = ref("");

const mariaDbStatus = ref<{ installed: boolean; version: string | null } | null>(null);
const platformInfo = ref("");

async function detectMariaDb() {
	try {
		const result = await window.electronAPI!.checkMariaDb();
		mariaDbStatus.value = { installed: result.installed, version: result.version };
	} catch {
		mariaDbStatus.value = { installed: false, version: null };
	}
}

(async () => {
	try {
		const info = await window.electronAPI!.getPlatformInfo();
		platformInfo.value = info.platform;
	} catch {
		/* ignore */
	}
	detectMariaDb();
})();

const testingErp = ref(false);
const erpTestResult = ref<boolean | null>(null);
const erpTestError = ref("");

const testingHub = ref(false);
const hubTestResult = ref<boolean | null>(null);

const completing = ref(false);
const setupError = ref("");

const canProceedStep3 = computed(() => {
	if (config.role === "hub") {
		// The till's API key is how its cashiers arrive from ERPNext; no one could sign in without it.
		return config.erpUrl && config.apiKey && config.apiSecret && erpTestResult.value;
	}
	return config.hubUrl && hubTestResult.value;
});

async function testDb() {
	testingDb.value = true;
	dbTestResult.value = null;
	dbTestError.value = "";
	try {
		const result = await window.electronAPI!.db.testConnection({
			host: config.dbHost,
			port: config.dbPort,
			user: config.dbUser,
			password: config.dbPassword,
			database: config.dbName,
		});
		dbTestResult.value = result.success;
		if (!result.success) dbTestError.value = result.error || "Connection failed";
	} catch (err) {
		dbTestResult.value = false;
		dbTestError.value = err instanceof Error ? err.message : "Connection failed";
	} finally {
		testingDb.value = false;
	}
}

async function testErpNext() {
	testingErp.value = true;
	erpTestResult.value = null;
	erpTestError.value = "";
	try {
		const result = await window.electronAPI!.testErpNext({
			url: config.erpUrl,
			apiKey: config.apiKey || undefined,
			apiSecret: config.apiSecret || undefined,
		});
		erpTestResult.value = result.success;
		if (!result.success) erpTestError.value = result.error || "Connection failed";
	} catch (err) {
		erpTestResult.value = false;
		erpTestError.value = err instanceof Error ? err.message : "Connection failed";
	} finally {
		testingErp.value = false;
	}
}

async function pingHub() {
	testingHub.value = true;
	hubTestResult.value = null;
	try {
		const resp = await fetch(`${config.hubUrl}/api/health`, {
			signal: AbortSignal.timeout(5000),
		});
		hubTestResult.value = resp.ok;
	} catch {
		hubTestResult.value = false;
	} finally {
		testingHub.value = false;
	}
}

async function completeSetup() {
	completing.value = true;
	setupError.value = "";
	try {
		const api = window.electronAPI!;

		const dbResult = await api.db.reinit({
			host: config.dbHost,
			port: config.dbPort,
			user: config.dbUser,
			password: config.dbPassword,
			database: config.dbName,
		});
		if (!dbResult.success) {
			setupError.value = `Database: ${dbResult.error}`;
			return;
		}

		if (config.role === "hub") {
			// Through the bridge: the app read the server and keys when it started, before
			// there were any, and this session's server calls use what it read.
			await setServerUrl(config.erpUrl);
			await api.db.setMeta("api_key", config.apiKey);
			await api.db.setMeta("api_secret", config.apiSecret);
			await warmApiCredentials();
		} else {
			await api.db.setMeta("hub_url", config.hubUrl);
		}

		const roleResult = await api.node.setRole({
			role: config.role,
			hubUrl: config.role === "till" ? config.hubUrl : undefined,
			tillId: config.role === "till" ? config.tillId : undefined,
			hubApiPort: config.role === "hub" ? config.hubApiPort : undefined,
		});

		if (!roleResult.success) {
			setupError.value = `Role setup: ${roleResult.error}`;
			return;
		}

		// Only cashiers from ERPNext sign in, so fetch them now rather than at the first sign-in.
		if (config.role === "hub") await api.startSyncEngine();
		else await api.node.triggerTillSync();

		toast.success("Setup completed successfully!");

		markSetupComplete();

		router.replace({ name: "login" });
	} catch (err) {
		setupError.value = err instanceof Error ? err.message : "Setup failed";
	} finally {
		completing.value = false;
	}
}
</script>
