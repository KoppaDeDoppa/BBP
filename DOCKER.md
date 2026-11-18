# BodenBar on a Raspberry Pi

This deployment runs the existing web app and the same-origin API in one Node container. SQLite data lives in the named `bodenbar-data` volume; it survives container replacement and restart. The database is not exposed as a network port.

## Start on the Pi

Install Docker Engine and the Docker Compose plugin, then copy this project to the Pi. From the project directory:

```bash
cp .env.example .env
```

Edit `.env` and set a unique admin username and password (at least 14 characters). Protect the file; it contains the bootstrap password. Then build and start:

```bash
docker compose up -d --build
```

Open `http://<raspberry-pi-lan-address>:3000` from a device on the same trusted network. Change the published host port with `PORT` in `.env` if needed. On first startup only, the initial admin is created from `ADMIN_USERNAME` and `ADMIN_PASSWORD`; changing those environment values later does not change an existing account. Staff accounts are created and managed in the app's Admin panel.

The image uses Node 22 and supports ARM64. Compose publishes only the app port and keeps the SQLite volume internal to Docker. Do not configure router port forwarding. Restrict access with the Wi-Fi/router firewall and use a trusted LAN: plain HTTP does not encrypt passwords, session cookies, or app data while they travel over the network. HTTPS reverse-proxy deployment needs additional trusted-proxy configuration; setting `COOKIE_SECURE=true` alone does not provide TLS.

## Optional Vipps display on the TV

Normal startup does not require TV configuration. Without it, only the TV action returns a controlled unavailable error; the POS remains usable.

In the POS `.env`, set these server-only variables (never put them in browser JavaScript):

```dotenv
TAP_DISPLAY_URL=http://10.0.0.33:3005
PAYMENT_DISPLAY_SECRET=<a-random-secret-at-least-32-characters>
```

Generate a secret, for example with `openssl rand -hex 32`, and configure the **same** `PAYMENT_DISPLAY_SECRET` on the TV receiver. Use a printable secret without whitespace. `TAP_DISPLAY_URL` must be a fixed HTTP(S) origin, with no credentials, path, query, or fragment. The LAN address above targets the TV host; `localhost` inside the POS container would target the POS itself. Restrict receiver access to the trusted LAN/firewall; HTTP transmits this bearer secret unencrypted. Recreate containers after changing environment variables.

For two Compose projects on the **same Docker host**, an optional shared network avoids reliance on the host's LAN address. Configure `TAP_DISPLAY_URL=http://tap-display:3005`, enable the TV project's matching override (which gives its service the `tap-display` alias), then run:

```bash
docker network create bodenbar-display
docker compose -f compose.yaml -f compose.payment-display.yaml up -d --build
```

Create the network once before either project starts. The override keeps the POS default network as well as attaching the external `bodenbar-display` network. Without this opt-in override, ordinary `docker compose up -d --build` is unchanged. Shared Docker networks do not connect separate physical hosts; use the LAN address in that case.

Staff and admins can select a nonarchived customer with a positive whole-NOK balance and press **Vis Vipps på TV**. The POS reads the current balance from SQLite and sends only the amount and a fresh request ID/deadline to the receiver. The TV must have its own QR image configured; an unconfigured receiver may reject the request. An accepted request lasts 30 seconds from receiver acceptance. The success message confirms receiver acceptance only, not that a physical TV rendered it or that payment occurred. This action does not modify balances, transactions, or financial history; register verified payment separately using the existing workflow.

## Optional estimated third keg

The POS can maintain one sales-based keg estimate with stable ID `helles-lager`. It starts disabled with no mapped products and no inferred historical consumption. In Admin, select the actual products for this tap (including free/member variants), enter capacity and current litres, and enable tracking. Every serving of a selected product consumes exactly 0.5 L, regardless of price. This is an estimate, not a scale reading; spills, foam and unregistered pours need explicit manual calibration.

Set `KEG_TRACKING_SECRET` in the POS `.env` and the same dedicated secret on the tap-display server. Generate it with `openssl rand -hex 32`; it must contain at least 32 printable non-whitespace ASCII characters. Do not reuse `PAYMENT_DISPLAY_SECRET`. Configure the display's server-only `POS_SERVER_URL` as the POS HTTP(S) origin reachable from that server/container (for example `http://bodenbar:3000` on a shared Docker network, or the POS host's LAN address). `localhost` inside the display container refers to the display, not the POS. Opt in to a display tap with `source: "estimated"` and ID `helles-lager`; other taps remain scale-driven. Recreate containers after environment changes. Keep the shared secret server-side and restrict access to the trusted LAN; plain HTTP does not encrypt bearer tokens.

The read-only `GET /api/integrations/kegs` endpoint requires `Authorization: Bearer <KEG_TRACKING_SECRET>` and disables caching. A successful disabled snapshot is `{ "kegs": [] }`; errors return non-200 status, never an empty successful snapshot. When enabled, the sole keg exposes `id`, `source: "estimated"`, `amount_left` and `max_keg_volume` in litres, `percent_of_beer_left`, and `updatedAt` (the last estimate/configuration change, not the last poll). The display should distinguish a failed/unavailable refresh from explicit disablement and recover automatically without subtracting consumption itself.

Undo restores the recorded serving only in its original active keg cycle. Product corrections reconcile volume; price-only edits and payments do not. Editing capacity, enabling/disabling, or changing mapped products without entering current litres preserves the estimate and cycle. Entering current litres explicitly calibrates a new accounting cycle; **new keg/reset** fills to the configured capacity and also starts a new cycle. Reversals of older-cycle purchases cannot change a replacement or calibrated keg. The internal balance may go below zero after overselling; visible volume is clamped, but undo uses the raw balance.

Deleting a customer/history or clearing data never refills the physical keg. Clear retains volume, starts a new cycle and prunes mapped products that no longer exist. Legacy version-2 JSON restore likewise retains volume, rotates the cycle and imports history without consumption attribution. Version-3 full JSON backups include `estimatedKeg` and each transaction's `consumption` (`null` or `{cycleId, ml}`): restoring one explicitly replaces the saved physical estimate and cycle as well as customer data. Verify the saved volume against the actual keg before restoring; calibrate afterward if beer has been served since that backup.

## Update and backup

To update from a newer project checkout, rebuild the image while retaining the volume:

```bash
docker compose up -d --build
```

Create a consistent SQLite backup using SQLite's online backup command from inside the container:

```bash
docker compose exec bodenbar node -e "const D=require('better-sqlite3');const d=new D('/data/bodenbar.sqlite');d.backup('/data/backup.sqlite').then(()=>{d.close();console.log('Backup saved to /data/backup.sqlite')})"
```

Copy the backup out of the container to another device/storage location:

```bash
docker cp bodenbar:/data/backup.sqlite ./bodenbar-backup.sqlite
```

The app also provides an Admin backup download and restore workflow. Keep backup files private because they contain customer names, balances, and transaction history. To restore the file generated by the app, use the Admin panel's restore action.

The app intentionally does not import the old browser-local data automatically. A new database starts with the default product menu and no customer or transaction history.

## Admin-panel sales PDF download

The **Admin** panel now includes a **Last ned salgsrapport (siste 30 dager)** button. It generates a Norwegian PDF on demand—no email configuration, scheduler, or external service required. The report covers sales and servings from the same Oslo wall-clock time 30 calendar dates earlier through the moment you click the button, including today's activity. Customer names, IDs, and current balances are never included. Historical Fat/Medlem flags cannot be reconstructed from stored transactions, and current prices do not rewrite historical amounts. Payments and corrections are shown separately; payments are not added to sales. Deleted or undone purchases are not recoverable; edited purchases keep their original timestamp. Archive customers to preserve history. This is an operational sales summary, not an accounting ledger.

No additional setup is needed beyond rebuilding the image with `docker compose up -d --build`. The PDF uses a bundled Liberation Sans font and requires no system packages. Open the POS in a browser, log in as an admin, open the Admin panel, and press the download button.
