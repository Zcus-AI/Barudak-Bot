const { formatDuration, formatBytes, formatRuntimeInfo } = require('../utils/metrics-format');

const UPTIME_LABELS = {
  uptime: '⏱️ Uptime',
  uptimeSec: '🧮 UptimeSec',
  rss: '🧠 RAM (RSS)',
  heapUsed: '📦 RAM (HeapUsed)',
  runtime: '🖥️ Runtime',
  node: '🧩 Node',
  arch: '🏗️ Arch'
};

function safeRuntimeCall(runtime, fnName, fallbackFactory) {
  try {
    if (runtime && typeof runtime[fnName] === 'function') {
      return runtime[fnName]();
    }
  } catch (_error) {
    // ignore runtime injection failures and use safe fallback
  }

  try {
    return fallbackFactory();
  } catch (_error) {
    return undefined;
  }
}

function normalizeNodeVersion(value) {
  const raw = String(value || '').trim();
  return raw || process.version;
}

function getRuntimeMeta(runtime = process) {
  const nodeVersion = normalizeNodeVersion(runtime?.version);
  const rawArch = String(runtime?.arch || process.arch).trim();
  return {
    runtimeText: formatRuntimeInfo(runtime),
    nodeVersion,
    arch: rawArch || process.arch
  };
}

function getMemoryTexts(memoryUsage) {
  return {
    rssText: formatBytes(memoryUsage?.rss),
    heapUsedText: formatBytes(memoryUsage?.heapUsed)
  };
}

function buildUptimeMessage(runtime = process) {
  const uptimeSeconds = safeRuntimeCall(runtime, 'uptime', () => process.uptime());
  const memoryUsage = safeRuntimeCall(runtime, 'memoryUsage', () => process.memoryUsage());

  const uptimeText = formatDuration(uptimeSeconds);
  const { rssText, heapUsedText } = getMemoryTexts(memoryUsage);
  const uptimeSecondsRaw = Math.max(0, Math.floor(Number(uptimeSeconds) || 0));
  const { runtimeText, nodeVersion, arch } = getRuntimeMeta(runtime);

  return [
    `${UPTIME_LABELS.uptime}: ${uptimeText}`,
    `${UPTIME_LABELS.uptimeSec}: ${uptimeSecondsRaw}`,
    `${UPTIME_LABELS.rss}: ${rssText}`,
    `${UPTIME_LABELS.heapUsed}: ${heapUsedText}`,
    `${UPTIME_LABELS.runtime}: ${runtimeText}`,
    `${UPTIME_LABELS.node}: ${nodeVersion}`,
    `${UPTIME_LABELS.arch}: ${arch}`
  ].join('\n');
}

module.exports = {
  data: {
    name: 'uptime',
    description: 'Lihat uptime bot saat ini'
  },
  cooldownMs: 5000,
  formatDuration,
  formatBytes,
  normalizeNodeVersion,
  buildUptimeMessage,
  async execute(interaction) {
    await interaction.reply({
      content: buildUptimeMessage(process),
      ephemeral: true
    });
  }
};
