const logger = require('../utils/logger');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    const cooldownMs = command.cooldownMs || 0;
    if (cooldownMs > 0) {
      const key = `${interaction.commandName}:${interaction.user.id}`;
      const check = client.cooldowns.check(key, cooldownMs);
      if (!check.allowed) {
        const retry = Math.ceil(check.retryAfterMs / 1000);
        await interaction.reply({
          content: `⏳ Tunggu ${retry} detik sebelum memakai command ini lagi.`,
          ephemeral: true
        });
        return;
      }
    }

    try {
      await command.execute(interaction, client);
    } catch (error) {
      logger.error(`Gagal jalankan /${interaction.commandName}`, error);
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: 'Terjadi error saat mengeksekusi command.', ephemeral: true });
      } else {
        await interaction.reply({ content: 'Terjadi error saat mengeksekusi command.', ephemeral: true });
      }
    }
  }
};
