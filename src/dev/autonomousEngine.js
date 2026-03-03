const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const logger = require('../utils/logger');

const execFileAsync = promisify(execFile);

class AutonomousEngine {
  constructor(options = {}) {
    this.controlPath = options.controlPath || path.join(process.cwd(), 'control.json');
    this.devLogPath = options.devLogPath || path.join(process.cwd(), 'dev_log.md');
    this.metricsPath = options.metricsPath || path.join(process.cwd(), 'src', 'dev', 'autonomous-metrics.json');
    this.iterationDelayMs = Math.max(60000, Number(options.iterationDelayMs) || 60000);
    this.running = false;
    this.timer = null;
    this.iterationCount = 0;
    this.didBootImprovement = false;
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

  readMetrics() {
    try {
      const raw = fs.readFileSync(this.metricsPath, 'utf8');
      return JSON.parse(raw);
    } catch {
      return { totalIterations: 0, lastIterationAt: null, improvements: [] };
    }
  }

  writeMetrics(metrics) {
    fs.mkdirSync(path.dirname(this.metricsPath), { recursive: true });
    fs.writeFileSync(this.metricsPath, JSON.stringify(metrics, null, 2) + '\n');
  }

  applyLoggingImprovement() {
    const now = new Date().toISOString();
    const metrics = this.readMetrics();
    metrics.totalIterations = Number(metrics.totalIterations || 0) + 1;
    metrics.lastIterationAt = now;
    metrics.improvements = Array.isArray(metrics.improvements) ? metrics.improvements : [];
    metrics.improvements.push({
      iteration: this.iterationCount,
      type: 'logging-improvement',
      note: 'Autonomous metrics diperbarui untuk observabilitas loop.'
    });

    if (metrics.improvements.length > 50) {
      metrics.improvements = metrics.improvements.slice(-50);
    }

    this.writeMetrics(metrics);
    return {
      action: 'Logging Improvement',
      details: 'Memperbarui src/dev/autonomous-metrics.json untuk tracking iterasi.'
    };
  }

  runOneImprovement() {
    // Anti-loop: lakukan improvement nyata sekali setelah boot/restart,
    // iterasi berikutnya hanya observasi sampai ada target improvement berikutnya.
    if (!this.didBootImprovement) {
      this.didBootImprovement = true;
      const result = this.applyLoggingImprovement();
      return { ...result, changed: true };
    }

    return {
      action: 'Observation',
      details: 'Tidak ada target improvement baru. Menunggu perubahan backlog agar tidak loop spam.',
      changed: false
    };
  }

  async runGitIntegration() {
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain']);
      if (!stdout.trim()) {
        return;
      }

      await execFileAsync('git', ['add', '.']);
      await execFileAsync('git', ['commit', '-m', 'auto: iteration update']);
      logger.info('Git commit success');

      try {
        await execFileAsync('git', ['push']);
        logger.info('Git push success');
      } catch (pushError) {
        logger.error('Git push failed', pushError.stderr || pushError.message || pushError);
      }
    } catch (error) {
      logger.error('Git integration failed', error.stderr || error.message || error);
    }
  }

  async runOneIteration() {
    this.iterationCount += 1;
    logger.info('Autonomous iteration started');

    const control = this.readControl();
    if (!control.autonomous_mode) {
      logger.info('Autonomous mode OFF, loop dihentikan.');
      this.stop();
      return;
    }

    const improvement = this.runOneImprovement();
    if (improvement.changed) {
      this.appendDevLog(improvement.action, improvement.details);
      await this.runGitIntegration();
    }

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

    const metrics = this.readMetrics();
    this.iterationCount = Number(metrics.totalIterations || 0);
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
