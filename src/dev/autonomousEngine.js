const fs = require('node:fs');
const path = require('node:path');
const logger = require('../utils/logger');

class AutonomousEngine {
  constructor(options = {}) {
    this.controlPath = options.controlPath || path.join(process.cwd(), 'control.json');
    this.devLogPath = options.devLogPath || path.join(process.cwd(), 'dev_log.md');
    this.iterationDelayMs = Math.max(60000, Number(options.iterationDelayMs) || 60000);
    this.running = false;
    this.timer = null;
    this.iterationCount = 0;
  }

  readControl() {
    try {
      const raw = fs.readFileSync(this.controlPath, 'utf8');
      return JSON.parse(raw);
    } catch (error) {
      logger.warn('Autonomous engine: gagal baca control.json, dianggap OFF');
      return { autonomous_mode: false };
    }
  }

  appendDevLog(kind, details) {
    const date = new Date().toISOString();
    const entry = `\n[ITERATION AUTO #${this.iterationCount}]\nTanggal: ${date}\nJenis Perubahan: ${kind}\nDeskripsi: ${details}\nStatus: Completed\n`;
    fs.appendFileSync(this.devLogPath, entry);
  }

  analyzeProject() {
    const checks = [
      path.join(process.cwd(), 'index.js'),
      path.join(process.cwd(), 'src', 'events', 'interactionCreate.js'),
      path.join(process.cwd(), 'tests', 'cooldown.test.js')
    ];

    const missing = checks.filter((f) => !fs.existsSync(f));
    if (missing.length > 0) {
      return {
        action: 'Bug Fix',
        details: `File penting hilang: ${missing.map((m) => path.basename(m)).join(', ')}`
      };
    }

    return {
      action: 'Feature Triage',
      details: 'Project stabil. Rekomendasi fitur kecil berikutnya: moderation warn command dengan permission check.'
    };
  }

  runOneIteration() {
    this.iterationCount += 1;
    logger.info('Autonomous iteration started');

    const control = this.readControl();
    if (!control.autonomous_mode) {
      logger.info('Autonomous mode OFF, loop dihentikan.');
      this.stop();
      return;
    }

    const analysis = this.analyzeProject();
    this.appendDevLog(analysis.action, analysis.details);
    logger.info('Autonomous iteration completed');
  }

  scheduleNext() {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      Promise.resolve()
        .then(() => this.runOneIteration())
        .catch((error) => logger.error('Autonomous iteration error', error))
        .finally(() => this.scheduleNext());
    }, this.iterationDelayMs);
  }

  start() {
    if (this.running) return;
    const control = this.readControl();
    if (!control.autonomous_mode) {
      logger.info('Autonomous engine tidak dijalankan (autonomous_mode=false).');
      return;
    }

    this.running = true;
    this.scheduleNext();
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

module.exports = AutonomousEngine;
