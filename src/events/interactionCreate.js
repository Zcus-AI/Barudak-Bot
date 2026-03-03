const logger = require('../utils/logger');

const COMMAND_EXECUTION_ERROR_MESSAGE = 'Terjadi error saat mengeksekusi command.';

function isBenignInteractionResponseError(error) {
  const code = Number(error?.code || error?.rawError?.code || 0);
  const message = String(error?.message || '').toLowerCase();
  return code === 10062 || code === 40060 || message.includes('unknown interaction');
}

function getCooldownAdapters(cooldowns) {
  return {
    normalizeCooldownMs:
      cooldowns && typeof cooldowns.normalizeCooldownMs === 'function'
        ? cooldowns.normalizeCooldownMs.bind(cooldowns)
        : (value) => Math.max(0, Number(value) || 0),
    check:
      cooldowns && typeof cooldowns.check === 'function'
        ? cooldowns.check.bind(cooldowns)
        : () => ({ allowed: true, retryAfterMs: 0 })
  };
}

async function sendCommandExecutionError(interaction, commandName) {
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: COMMAND_EXECUTION_ERROR_MESSAGE, ephemeral: true });
    } else {
      await interaction.reply({ content: COMMAND_EXECUTION_ERROR_MESSAGE, ephemeral: true });
    }
  } catch (replyError) {
    if (isBenignInteractionResponseError(replyError)) {
      logger.info(`Skip kirim error response /${commandName} (interaction sudah tidak valid)`);
    } else {
      logger.warn('Gagal mengirim error response interaction', replyError);
    }
  }
}

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    const commandName = interaction?.commandName || 'unknown';

    try {
      if (!interaction.isChatInputCommand()) return;

      if (!client?.commands || typeof client.commands.get !== 'function') {
        logger.warn('Lewati interaction: client.commands tidak valid');
        return;
      }

      if (typeof interaction.commandName !== 'string' || !interaction.commandName.trim()) {
        logger.warn('Lewati interaction: commandName tidak valid');
        return;
      }

      const command = client.commands.get(interaction.commandName);
      if (!command) {
        logger.warn(`Command /${interaction.commandName} tidak ditemukan di registry`);
        return;
      }
      if (typeof command.execute !== 'function') {
        logger.warn(`Invalid command handler format untuk /${interaction.commandName}`);
        return;
      }

      const cooldown = getCooldownAdapters(client.cooldowns);
      const cooldownMs = cooldown.normalizeCooldownMs(command.cooldownMs);
      if (cooldownMs > 0) {
        const userId = interaction.user?.id;
        if (!userId) {
          logger.warn(`Lewati cooldown /${interaction.commandName} karena user id tidak tersedia`);
        } else {
          const key = `${interaction.commandName}:${userId}`;
          const check = cooldown.check(key, cooldownMs);
          if (!check.allowed) {
            const retry = Math.max(1, Math.ceil(check.retryAfterMs / 1000));
            logger.info(`Cooldown block /${interaction.commandName} user:${userId} retry_after:${retry}s`);
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

      const startedAt = Date.now();
      await command.execute(interaction, client);
      const elapsedMs = Date.now() - startedAt;
      logger.info(`Command /${commandName} selesai dalam ${elapsedMs}ms`);
    } catch (error) {
      logger.error(`Gagal jalankan /${commandName}`, error);
      await sendCommandExecutionError(interaction, commandName);
    }
  }
};
