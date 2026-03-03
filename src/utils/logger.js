const now = () => new Date().toISOString();

const logger = {
  info: (message, ...rest) => console.log(`[INFO] ${now()} ${message}`, ...rest),
  warn: (message, ...rest) => console.warn(`[WARN] ${now()} ${message}`, ...rest),
  error: (message, ...rest) => console.error(`[ERROR] ${now()} ${message}`, ...rest)
};

module.exports = logger;
