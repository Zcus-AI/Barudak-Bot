const { getInteractionLatencyMs } = require('../utils/metrics-format');

function getWebsocketPingMs(client) {
  const wsPing = Number(client?.ws?.ping);
  if (!Number.isFinite(wsPing) || wsPing < 0) {
    return null;
  }
  return Math.floor(wsPing);
}

module.exports = {
  data: {
    name: 'ping',
    description: 'Balas dengan Pong!'
  },
  cooldownMs: 3000,
  getLatencyMs: getInteractionLatencyMs,
  getWebsocketPingMs,
  async execute(interaction, client) {
    const latencyMs = getInteractionLatencyMs(interaction);
    const wsPingMs = getWebsocketPingMs(client);

    const latencyText = latencyMs === null ? 'n/a' : `${latencyMs}ms`;
    const wsPingText = wsPingMs === null ? 'n/a' : `${wsPingMs}ms`;

    await interaction.reply({
      content: `🏓 Pong! Latency: ${latencyText} | WS: ${wsPingText}`,
      ephemeral: true
    });
  }
};
