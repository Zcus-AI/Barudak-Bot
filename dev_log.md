[ITERATION #1]
Tanggal: 2026-03-03
Jenis Perubahan: Initial Setup
Deskripsi: Setup struktur awal Discord Bot
Status: Struktur berhasil dibuat

[ITERATION #2]
Tanggal: 2026-03-03
Jenis Perubahan: Feature Increment
Fitur: Cooldown system untuk slash commands
File Dibuat:
- src/utils/cooldown.js
- tests/cooldown.test.js
File Diubah:
- index.js
- src/events/interactionCreate.js
- README.md
Deskripsi: Menambahkan cooldown per-command agar spam command berkurang dan bot lebih stabil.
Status Runtime: Siap dijalankan (npm start)
Next Plan: Tambah fitur moderation sederhana (warn/timeout) dengan penyimpanan in-memory ringan.
