const logger = require('../utils/logger');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    try {
      if (!interaction.isChatInputCommand()) return;

      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      if (typeof command.execute !== 'function') {
        logger.warn('Invalid command handler format');
        return;
      }

      const cooldowns = client.cooldowns;
      const normalizeCooldownMs =
        cooldowns && typeof cooldowns.normalizeCooldownMs === 'function'
          ? cooldowns.normalizeCooldownMs.bind(cooldowns)
          : (value) => Math.max(0, Number(value) || 0);
      const cooldownCheck =
        cooldowns && typeof cooldowns.check === 'function'
          ? cooldowns.check.bind(cooldowns)
          : () => ({ allowed: true, retryAfterMs: 0 });

      const cooldownMs = normalizeCooldownMs(command.cooldownMs);
      if (cooldownMs > 0) {
        const userId = interaction.user?.id;
        if (!userId) {
          logger.warn(`Lewati cooldown /${interaction.commandName} karena user id tidak tersedia`);
        } else {
          const key = `${interaction.commandName}:${userId}`;
          const check = cooldownCheck(key, cooldownMs);
          if (!check.allowed) {
            const retry = Math.max(1, Math.ceil(check.retryAfterMs / 1000));
            if (!interaction.replied && !interaction.deferred) {
              await interaction.reply({
                content: `⏳ Tunggu ${retry} detik sebelum memakai command ini lagi.`,
                ephemeral: true
              });
            }
            return;
          }
        }
      }

      await command.execute(interaction, client);
    } catch (error) {
      logger.error(`Gagal jalankan /${interaction.commandName}`, error);
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: 'Terjadi error saat mengeksekusi command.', ephemeral: true });
        } else {
          await interaction.reply({ content: 'Terjadi error saat mengeksekusi command.', ephemeral: true });
        }
      } catch (replyError) {
        logger.warn('Gagal mengirim error response interaction', replyError);
      }
    }
  }
};
