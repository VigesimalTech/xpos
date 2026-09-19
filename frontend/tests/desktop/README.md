# Desktop end-to-end tests

Playwright starts the built Electron app and works it as a cashier would, against a real
ERPNext: a new till is set up through its wizard, a cashier signs in, opens a shift, sells,
holds and restores an order, looks up the day's orders, records an expense and a bank drop,
and closes the shift. Each step checks what the till printed and what reached ERPNext.

They sit on top of the other layers:

|                         | What runs                                 | Server  |
| ----------------------- | ----------------------------------------- | ------- |
| `yarn test`             | stores and services, in jsdom             | none    |
| `yarn test:integration` | the main process's database and sync code | stubbed |
| `yarn test:roundtrip`   | the sync engine                           | real    |
| `yarn test:desktop`     | the whole app, through its screens        | real    |

The Cypress specs in `tests/e2e` drive the web POS in a browser with a stubbed server.

## Running

You need a site seeded by `xpos/tests/round_trip.py` (CI does this in `tests.yml`) and a local
MariaDB for the till's own database:

```bash
bench --site <site> execute xpos.tests.round_trip.setup --kwargs '{"out": "/tmp/xpos-rt.json"}'

yarn build:electron
XPOS_RT_CONFIG=/tmp/xpos-rt.json XPOS_RT_URL=http://<site>:8000 yarn test:desktop
```

`XPOS_TEST_DB_HOST`, `_PORT`, `_USER`, `_PASSWORD` and `_NAME` point at the till's database;
the defaults are `127.0.0.1:3307`, `xpos`/`xpos`, `test_xpos_desktop`. The database must be
named `test_…`: it is dropped and created again for every run.

Without `XPOS_RT_CONFIG` the tests skip.

## How a till is isolated

The app runs on a profile of its own (`XPOS_USER_DATA_DIR`, a temporary folder), so it never
reads or writes an installed till's settings, database config or logs. The receipt printer is
replaced by a recorder, so `till.printed()` returns the HTML the till would have printed.

The same variable runs a trial build by hand beside an installed till:

```bash
XPOS_USER_DATA_DIR=~/xpos-trial "/path/to/X POS.app/Contents/MacOS/X POS"
```

## When a step fails

Each failed step leaves a screenshot, a trace and the page's accessibility tree in
`test-results/desktop/`; `npx playwright show-trace <trace.zip>` replays it. The steps share
one till and run in order, so the steps after a failure are skipped.
