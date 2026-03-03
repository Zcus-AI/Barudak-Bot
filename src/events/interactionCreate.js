const logger = require('../utils/logger');

function isBenignInteractionResponseError(error) {
  const code = Number(error?.code || error?.rawError?.code || 0);
  const message = String(error?.message || '').toLowerCase();
  return code === 10062 || code === 40060 || message.includes('unknown interaction');
}

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    const commandName = interaction?.commandName || 'unknown';

    try {
      if (!interaction.isChatInputCommand()) return;

      const command = client.commands.get(interaction.commandName);
      if (!command) {
        logger.warn(`Command /${interaction.commandName} tidak ditemukan di registry`);
        return;
      }
      if (typeof command.execute !== 'function') {
        logger.warn(`Invalid command handler format untuk /${interaction.commandName}`);
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
            logger.info(
              `Cooldown block /${interaction.commandName} user:${userId} retry_after:${retry}s`
            );
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
      logger.error(`Gagal jalankan /${commandName}`, error);
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: 'Terjadi error saat mengeksekusi command.', ephemeral: true });
        } else {
          await interaction.reply({ content: 'Terjadi error saat mengeksekusi command.', ephemeral: true });
        }
      } catch (replyError) {
        if (isBenignInteractionResponseError(replyError)) {
          logger.info(`Skip kirim error response /${commandName} (interaction sudah tidak valid)`);
        } else {
          logger.warn('Gagal mengirim error response interaction', replyError);
        }
      }
    }
  }
};
