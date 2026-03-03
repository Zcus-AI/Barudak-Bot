const { getInteractionLatencyMs } = require('../utils/metrics-format');

module.exports = {
  data: {
    name: 'ping',
    description: 'Balas dengan Pong!'
  },
  cooldownMs: 3000,
  getLatencyMs: getInteractionLatencyMs,
  async execute(interaction) {
    const latencyMs = getInteractionLatencyMs(interaction);
    const latencyText = latencyMs === null ? 'n/a' : `${latencyMs}ms`;

    await interaction.reply({
      content: `🏓 Pong! Latency: ${latencyText}`,
      ephemeral: true
    });
  }
};
