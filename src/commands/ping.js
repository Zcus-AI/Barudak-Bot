const { getInteractionLatencyMs } = require('../utils/metrics-format');

function getWebsocketPingMs(client) {
  const wsPing = Number(client?.ws?.ping);
  if (!Number.isFinite(wsPing) || wsPing < 0) {
    return null;
  }
  return Math.floor(wsPing);
}

function formatMs(value) {
  return value === null ? 'n/a' : `${value}ms`;
}

function buildPingMessage(interaction, client) {
  const latencyMs = getInteractionLatencyMs(interaction);
  const wsPingMs = getWebsocketPingMs(client);
  return `🏓 Pong! Latency: ${formatMs(latencyMs)} | WS: ${formatMs(wsPingMs)}`;
}

module.exports = {
  data: {
    name: 'ping',
    description: 'Balas dengan Pong!'
  },
  cooldownMs: 3000,
  getLatencyMs: getInteractionLatencyMs,
  getWebsocketPingMs,
  buildPingMessage,
  async execute(interaction, client) {
    await interaction.reply({
      content: buildPingMessage(interaction, client),
      ephemeral: true
    });
  }
};
