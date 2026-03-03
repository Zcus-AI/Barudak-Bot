const logger = require('../utils/logger');

module.exports = {
  name: 'ready',
  once: true,
  execute(client) {
    logger.info(`Bot online sebagai ${client.user.tag}`);
  }
};
