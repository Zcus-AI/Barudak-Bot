const { formatDuration, formatBytes, formatRuntimeInfo } = require('../utils/metrics-format');

function safeRuntimeCall(runtime, fnName, fallbackValue) {
  try {
    if (runtime && typeof runtime[fnName] === 'function') {
      return runtime[fnName]();
    }
  } catch (_error) {
    // ignore runtime injection failures and use safe fallback
  }
  return fallbackValue;
}

function buildUptimeMessage(runtime = process) {
  const uptimeSeconds = safeRuntimeCall(runtime, 'uptime', process.uptime());
  const memoryUsage = safeRuntimeCall(runtime, 'memoryUsage', process.memoryUsage());

  const uptimeText = formatDuration(uptimeSeconds);
  const rssText = formatBytes(memoryUsage?.rss);
  const runtimeText = formatRuntimeInfo(runtime);
  const nodeVersion = runtime?.version || process.version;
  const arch = String(runtime?.arch || process.arch);

  return `⏱️ Uptime: ${uptimeText}\n🧠 RAM (RSS): ${rssText}\n🖥️ Runtime: ${runtimeText}\n🧩 Node: ${nodeVersion}\n🏗️ Arch: ${arch}`;
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
