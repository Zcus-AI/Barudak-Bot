function getLatencyMs(interaction) {
  const createdAt = Number(interaction?.createdTimestamp);
  if (!Number.isFinite(createdAt) || createdAt <= 0) {
    return null;
  }
  const latency = Date.now() - createdAt;
  return Math.max(0, Math.floor(latency));
}

module.exports = {
  data: {
    name: 'ping',
    description: 'Balas dengan Pong!'
  },
  cooldownMs: 3000,
  getLatencyMs,
  async execute(interaction) {
    const latencyMs = getLatencyMs(interaction);
    const latencyText = latencyMs === null ? 'n/a' : `${latencyMs}ms`;

    await interaction.reply({
      content: `🏓 Pong! Latency: ${latencyText}`,
      ephemeral: true
    });
  }
};
