# Barudak Bot (Discord Bot)

Struktur modular Discord bot berbasis `discord.js` dengan command loader, event loader, logging, dan cooldown system.

## Struktur

- `index.js` - entrypoint utama bot Discord
- `src/commands` - kumpulan slash command
- `src/events` - event handler Discord
- `src/utils` - utilitas (logger + cooldown)
- `src/config` - konfigurasi environment
- `autonomous/index.js` - entrypoint khusus sistem autonomous (terpisah dari bot)
- `autonomous/autonomousEngine.js` - engine autonomous
- `autonomous/control.json` - kontrol autonomous mode (khusus subsystem autonomous)
- `autonomous/dev_log.md` - catatan iterasi subsystem autonomous
- `tests` - test sederhana

## Environment

Buat `.env`:

```env
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_application_id
DISCORD_GUILD_ID=optional_for_dev
```

## Menjalankan

### Bot saja (default)

```bash
npm start
# atau
npm run start:bot
```

### Autonomous subsystem (opsional, runtime terpisah)

```bash
npm run start:autonomous
```

## Testing

```bash
node tests/cooldown.test.js
```
