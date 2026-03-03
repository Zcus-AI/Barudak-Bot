const { formatDuration, formatBytes } = require('../utils/metrics-format');

module.exports = {
  data: {
    name: 'uptime',
    description: 'Lihat uptime bot saat ini'
  },
  cooldownMs: 5000,
  formatDuration,
  formatBytes,
  async execute(interaction) {
    const uptimeText = formatDuration(process.uptime());
    const rssText = formatBytes(process.memoryUsage().rss);

    await interaction.reply({
      content: `⏱️ Uptime: ${uptimeText}\n🧠 RAM (RSS): ${rssText}`,
      ephemeral: true
    });
  }
};
