const logger = require('../utils/logger');

const COMMAND_EXECUTION_ERROR_MESSAGE = 'Terjadi error saat mengeksekusi command.';
const SLOW_COMMAND_THRESHOLD_MS = 1000;

function commandLabel(commandName) {
  const normalized =
    typeof commandName === 'string' && commandName.trim() ? commandName.trim() : 'unknown';
  return `/${normalized}`;
}

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
      logger.info(`Skip kirim error response ${commandLabel(commandName)} (interaction sudah tidak valid)`);
    } else {
      logger.warn(`Gagal mengirim error response interaction ${commandLabel(commandName)}`, replyError);
    }
  }
}

async function sendCooldownReply(interaction, commandName, retrySeconds) {
  try {
    await interaction.reply({
      content: `⏳ Tunggu ${retrySeconds} detik sebelum memakai command ini lagi.`,
      ephemeral: true
    });
  } catch (error) {
    if (isBenignInteractionResponseError(error)) {
      logger.info(`Skip cooldown response ${commandLabel(commandName)} (interaction sudah tidak valid)`);
    } else {
      logger.warn(`Gagal mengirim cooldown response ${commandLabel(commandName)}`, error);
    }
  }
}

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    const commandNameRaw = interaction?.commandName;
    const commandName =
      typeof commandNameRaw === 'string' && commandNameRaw.trim() ? commandNameRaw.trim() : 'unknown';

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

      const interactionCommandName = interaction.commandName.trim();
      const scope = interaction.guildId ? 'guild' : 'dm';
      const userIdForLog = interaction.user?.id || 'unknown-user';
      logger.info(`Terima ${commandLabel(interactionCommandName)} dari ${userIdForLog} di ${scope}`);

      const command = client.commands.get(interactionCommandName);
      if (!command) {
        logger.warn(`Command ${commandLabel(interactionCommandName)} tidak ditemukan di registry`);
        return;
      }
      if (typeof command.execute !== 'function') {
        logger.warn(`Invalid command handler format untuk ${commandLabel(interactionCommandName)}`);
        return;
      }

      const cooldown = getCooldownAdapters(client.cooldowns);
      const cooldownMs = cooldown.normalizeCooldownMs(command.cooldownMs);
      if (cooldownMs > 0) {
        const userId = interaction.user?.id;
        if (!userId) {
          logger.warn(`Lewati cooldown ${commandLabel(interactionCommandName)} karena user id tidak tersedia`);
        } else {
          const key = `${interactionCommandName}:${userId}`;
          const check = cooldown.check(key, cooldownMs);
          if (!check.allowed) {
            const retry = Math.max(1, Math.ceil(check.retryAfterMs / 1000));
            logger.info(`Cooldown block ${commandLabel(interactionCommandName)} user:${userId} retry_after:${retry}s`);
            if (!interaction.replied && !interaction.deferred) {
              await sendCooldownReply(interaction, interactionCommandName, retry);
            }
            return;
          }
        }
      }

      const startedAt = Date.now();
      await command.execute(interaction, client);
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= SLOW_COMMAND_THRESHOLD_MS) {
        logger.warn(`Command ${commandLabel(commandName)} lambat: ${elapsedMs}ms (>=${SLOW_COMMAND_THRESHOLD_MS}ms)`);
      } else {
        logger.info(`Command ${commandLabel(commandName)} selesai dalam ${elapsedMs}ms`);
      }
    } catch (error) {
      logger.error(`Gagal jalankan ${commandLabel(commandName)}`, error);
      await sendCommandExecutionError(interaction, commandName);
    }
  }
};
