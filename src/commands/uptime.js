const { formatDuration, formatBytes, formatRuntimeInfo } = require('../utils/metrics-format');

function buildUptimeMessage(runtime = process) {
  const uptimeText = formatDuration(runtime.uptime());
  const rssText = formatBytes(runtime.memoryUsage().rss);
  const runtimeText = formatRuntimeInfo(runtime);
  const nodeVersion = runtime.version || process.version;

  return `⏱️ Uptime: ${uptimeText}\n🧠 RAM (RSS): ${rssText}\n🖥️ Runtime: ${runtimeText}\n🧩 Node: ${nodeVersion}`;
}

module.exports = {
  data: {
    name: 'uptime',
    description: 'Lihat uptime bot saat ini'
  },
  cooldownMs: 5000,
  formatDuration,
  formatBytes,
  buildUptimeMessage,
  async execute(interaction) {
    await interaction.reply({
      content: buildUptimeMessage(process),
      ephemeral: true
    });
  }
};
