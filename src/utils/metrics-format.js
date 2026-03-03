function formatDuration(totalSeconds) {
  const safe = Math.max(0, Number(totalSeconds) || 0);
  const days = Math.floor(safe / 86400);
  const hours = Math.floor((safe % 86400) / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60);

  const parts = [];
  if (days > 0) parts.push(`${days}h`);
  parts.push(`${hours}j`, `${minutes}m`, `${seconds}d`);
  return parts.join(' ');
}

function formatBytes(bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = n / 1024;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(1)} ${units[idx]}`;
}

function getInteractionLatencyMs(interaction) {
  const createdAt = Number(interaction?.createdTimestamp);
  if (!Number.isFinite(createdAt) || createdAt <= 0) {
    return null;
  }
  const latency = Date.now() - createdAt;
  return Math.max(0, Math.floor(latency));
}

function formatRuntimeInfo(runtime = process) {
  const rawPlatform = String(runtime?.platform || process.platform).trim();
  const safePlatform = rawPlatform || process.platform;

  const pid = Number(runtime?.pid || process.pid);
  const safePid = Number.isFinite(pid) && pid > 0 ? Math.floor(pid) : process.pid;

  return `${safePlatform} | pid:${safePid}`;
}

module.exports = {
  formatDuration,
  formatBytes,
  getInteractionLatencyMs,
  formatRuntimeInfo
};
