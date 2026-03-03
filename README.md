# Discord Multi Bot Voice Defend

Script Node.js untuk kontrol banyak bot Discord dari 1 controller bot.

## Struktur Project
- Source TypeScript ada di `src/`
- Entry utama: `src/index.ts`
- Layer DB: `src/store/db-store.ts`
- Helper scripts: `src/scripts/*.ts`
- Build output: `dist/`

## Fitur
- `/addbot token [label]`
- `/listbot`
- `/delbot id`
- `/editbot id [token] [label]`
- `/join [id] [channel] [defend]` (kalau id kosong = semua bot)
- `/leave id`
- `/invite code [id]` (generate link invite bot ke guild dari invite code)
- Multi-guild: bot yang sama bisa join voice di banyak server sekaligus.
- Mode `defend`: auto rejoin per guild kalau dipindah/terputus dari voice.
- Auto detect guild: controller otomatis deploy command ke semua guild yang dia join.
- Persist voice state: channel voice terakhir disimpan ke MySQL dan bisa auto-restore saat bot restart.
- `createbot`: helper CLI untuk validasi token bot dan tambah ke MySQL.

## Setup
1. Copy `.env.example` jadi `.env` lalu isi:
   - `CONTROLLER_TOKEN`
   - `CONTROLLER_CLIENT_ID`
   - `MYSQL_HOST`
   - `MYSQL_PORT`
   - `MYSQL_USER`
   - `MYSQL_PASSWORD`
   - `MYSQL_DATABASE`
   - `GLOBAL_COMMANDS` (opsional)
2. Install deps:
   ```bash
   npm install
   ```
3. Jalankan bot controller:
   ```bash
   npm run start
   ```
4. Kalau sebelumnya pakai `bots.json`, migrate sekali:
   ```bash
   npm run migrate:mysql
   ```

## Helper createbot
- Interaktif:
  ```bash
  npm run createbot
  ```
- Dengan argumen:
  ```bash
  npm run createbot -- --token YOUR_BOT_TOKEN --label "Bot Musik"
  ```
- Fungsi script:
  - login pakai token bot (validasi token)
  - ambil `clientId` otomatis
  - generate `id` internal
  - simpan ke MySQL

## Batch Add Tokens
- Default (tanpa argumen): otomatis baca `./tokens.json`
  ```bash
  npm run batch:add
  ```
- Dengan CSV:
  ```bash
  npm run batch:add -- --tokens token1,token2,token3
  ```
- Dengan file custom:
  ```bash
  npm run batch:add -- --file tokens.json
  ```

## Catatan command deploy
- Default (`GLOBAL_COMMANDS=false`): command di-deploy per guild secara otomatis (cepat muncul).
- Kalau `GLOBAL_COMMANDS=true`: command global untuk semua server, tapi propagasi bisa lama.
- Saat controller baru diundang ke guild, command otomatis di-deploy ke guild itu.

## Catatan penting
- Discord tidak menyediakan API resmi untuk bikin aplikasi/bot di Developer Portal + ambil token secara otomatis.
- Jadi pembuatan aplikasi bot tetap manual di Developer Portal; setelah dapat token, pakai `npm run createbot` atau `/addbot`.
  
- Bot Discord tidak bisa join guild full otomatis hanya dari invite code tanpa authorize admin.
- Command `/invite` akan skip link untuk bot yang sudah ada di guild target.
- Output `/invite` dan `/join` ditampilkan urut berdasarkan label bot.
- Semua token bot disimpan di MySQL (plain text). Amankan akses database.
- Setiap bot yang ditambahkan harus punya permission voice connect/speak di guild target.
- Slash command dibatasi untuk admin via default permissions.

## Data storage
- Tabel `bots` menyimpan data bot (`id`, `token`, `label`, `client_id`).
- Tabel `bot_voice_states` menyimpan voice state per baris (`bot_id`, `guild_id`, `channel_id`, `defend`).
- Tabel `app_config` menyimpan config runtime (`monitor.channelId`, `monitor.messageId`).
- Tabel akan dibuat otomatis saat bot pertama kali jalan dan konek ke MySQL.
