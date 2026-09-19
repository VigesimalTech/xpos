/**
 * The till's local MariaDB for integration tests.
 *
 * Connection comes from XPOS_TEST_DB_* (defaults suit a local MariaDB on
 * 3307 and CI's service). The database name must start with `test_`: every
 * run drops and recreates it, so a real till database can never be named.
 */
import mysql from "mysql2/promise";
import { closeDatabase, execute, initDatabase } from "../../../electron/database/dbService";

export const testDbConfig = {
	host: process.env.XPOS_TEST_DB_HOST || "127.0.0.1",
	port: Number(process.env.XPOS_TEST_DB_PORT || 3307),
	user: process.env.XPOS_TEST_DB_USER || "xpos",
	password: process.env.XPOS_TEST_DB_PASSWORD || "xpos",
	database: process.env.XPOS_TEST_DB_NAME || "test_xpos_sync",
};

if (!testDbConfig.database.startsWith("test_")) {
	throw new Error(
		`Refusing to use database "${testDbConfig.database}": test databases must start with test_`,
	);
}

/** Drop and recreate the test database, then load the app's schema into it. */
export async function createTestDb(): Promise<void> {
	const { database, ...server } = testDbConfig;
	const conn = await mysql.createConnection(server);
	try {
		await conn.query(`DROP DATABASE IF EXISTS \`${database}\``);
	} finally {
		await conn.end();
	}
	await initDatabase(testDbConfig);
}

/** Empty the tables sync reads and writes, between tests. */
export async function clearSyncTables(): Promise<void> {
	for (const table of [
		"pending_invoices",
		"pending_purchases",
		"pos_opening_shifts",
		"pos_closing_entries",
		"expenses",
		"bank_drops",
		"sync_id_map",
	]) {
		await execute(`DELETE FROM \`${table}\``);
	}
}

export async function closeTestDb(): Promise<void> {
	await closeDatabase();
}
