/**
 * One signing key for the whole round-trip run, kept between runs (K43).
 *
 * A real till has one key. Each test file runs in a process of its own, with a
 * temporary folder of its own, and would make a key of its own: ERPNext keeps the first
 * key a till user's sales carry, and would flag every other file's sales as signed with
 * a different key.
 */
import os from "os";
import path from "path";
import { setTillKeyDir } from "../../electron/security/tillKey";

setTillKeyDir(path.join(os.tmpdir(), "xpos-roundtrip-till-key"));
