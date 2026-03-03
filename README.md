# Barudak Bot (Autonomous Discord Bot)

Struktur modular Discord bot berbasis `discord.js` dengan command loader, event loader, logging, dan cooldown system.

## Struktur

- `index.js` - entrypoint utama bot
- `src/commands` - kumpulan slash command
- `src/events` - event handler Discord
- `src/utils` - utilitas (logger + cooldown)
- `src/config` - konfigurasi environment
- `tests` - test sederhana
- `control.json` - kontrol autonomous mode
- `dev_log.md` - catatan iterasi pengembangan

## Environment

Buat `.env`:

```env
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_application_id
DISCORD_GUILD_ID=optional_for_dev
```

## Menjalankan

```bash
npm install
npm start
```

## Testing

```bash
node tests/cooldown.test.js
```
