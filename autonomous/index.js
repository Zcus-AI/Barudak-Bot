require('dotenv').config();
const path = require('node:path');
const AutonomousEngine = require('./autonomousEngine');
const logger = require('../src/utils/logger');

const engine = new AutonomousEngine({
  controlPath: path.join(__dirname, '..', 'control.json'),
  devLogPath: path.join(__dirname, '..', 'dev_log.md'),
  iterationDelayMs: 60000
});

logger.info('Starting autonomous subsystem from dedicated runtime...');
engine.start();
