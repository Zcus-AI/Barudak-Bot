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
    this.iterationDelayMs = Math.max(60000, Number(options.iterationDelayMs) || 60000);
    this.running = false;
    this.timer = null;
    this.iterationCount = 0;
    this.ignoredFiles = new Set([
      'src/dev/autonomous-metrics.json',
      'dev_log.md',
      'control.json'
    ]);
  }

  readControl() {
    try {
      const raw = fs.readFileSync(this.controlPath, 'utf8');
      return JSON.parse(raw);
    } catch {
      logger.warn('Autonomous engine: gagal baca control.json, dianggap OFF');
      return { autonomous_mode: false };
    }
  }

  appendDevLog(kind, details) {
    const date = new Date().toISOString();
    const entry = `\n[ITERATION AUTO #${this.iterationCount}]\nTanggal: ${date}\nJenis Perubahan: ${kind}\nDeskripsi: ${details}\nStatus: Completed\n`;
    fs.appendFileSync(this.devLogPath, entry);
  }

  async git(args) {
    return execFileAsync('git', args, { cwd: process.cwd() });
  }

  fileExists(relPath) {
    return fs.existsSync(path.join(process.cwd(), relPath));
  }

  ensureUptimeCommand() {
    const rel = 'src/commands/uptime.js';
    if (this.fileExists(rel)) {
      return null;
    }

    const content = `module.exports = {
  data: {
    name: 'uptime',
    description: 'Lihat uptime bot saat ini'
  },
  cooldownMs: 5000,
  async execute(interaction) {
    const total = Math.floor(process.uptime());
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    await interaction.reply({
      content: \`⏱️ Uptime: \${hours}j \${minutes}m \${seconds}d\`,
      ephemeral: true
    });
  }
};
`;

    fs.writeFileSync(path.join(process.cwd(), rel), content);
    return {
      action: 'Feature Improvement',
      details: 'Menambahkan command /uptime untuk utilitas monitoring bot.',
      changedFiles: [rel]
    };
  }

  ensureInteractionValidation() {
    const rel = 'src/events/interactionCreate.js';
    const abs = path.join(process.cwd(), rel);
    const raw = fs.readFileSync(abs, 'utf8');
    if (raw.includes('Invalid command handler format')) {
      return null;
    }

    const target = "      const command = client.commands.get(interaction.commandName);\n      if (!command) return;\n\n";
    if (!raw.includes(target)) {
      return null;
    }

    const patched = raw.replace(
      target,
      "      const command = client.commands.get(interaction.commandName);\n      if (!command) return;\n      if (typeof command.execute !== 'function') {\n        logger.warn('Invalid command handler format');\n        return;\n      }\n\n"
    );

    fs.writeFileSync(abs, patched);
    return {
      action: 'Validation Improvement',
      details: 'Menambahkan validasi command.execute pada interaction handler.',
      changedFiles: [rel]
    };
  }

  ensureUptimeTest() {
    const rel = 'tests/uptime-command.test.js';
    if (this.fileExists(rel)) {
      return null;
    }

    const content = `const assert = require('node:assert');
const cmd = require('../src/commands/uptime');

assert.strictEqual(cmd.data.name, 'uptime');
assert.strictEqual(typeof cmd.execute, 'function');
console.log('uptime-command.test.js passed');
`;
    fs.writeFileSync(path.join(process.cwd(), rel), content);
    return {
      action: 'Testing Improvement',
      details: 'Menambahkan test sederhana untuk command /uptime.',
      changedFiles: [rel]
    };
  }

  runOneImprovement() {
    const steps = [
      () => this.ensureUptimeCommand(),
      () => this.ensureInteractionValidation(),
      () => this.ensureUptimeTest()
    ];

    for (const step of steps) {
      const result = step();
      if (result) return result;
    }

    return {
      action: 'Refactor Improvement',
      details: 'Tidak ada task baru pada katalog improvement saat ini.',
      changedFiles: []
    };
  }

  async getMeaningfulChangedFiles() {
    const { stdout } = await this.git(['status', '--porcelain']);
    const files = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.slice(3));

    return files.filter((f) => !this.ignoredFiles.has(f));
  }

  async validateBeforeCommit(changedFiles) {
    await execFileAsync('node', ['--check', 'index.js'], { cwd: process.cwd() });
    for (const file of changedFiles) {
      if (file.endsWith('.js')) {
        await execFileAsync('node', ['--check', file], { cwd: process.cwd() });
      }
    }
  }

  async rollbackLastCommit() {
    try {
      await this.git(['reset', '--hard', 'HEAD~1']);
      logger.error('Rollback executed due to runtime failure');
    } catch (error) {
      logger.error('Rollback failed', error.stderr || error.message || error);
    }
  }

  async runGitIntegration() {
    try {
      const meaningfulChanges = await this.getMeaningfulChangedFiles();
      if (meaningfulChanges.length === 0) {
        logger.info('No meaningful project changes detected');
        return false;
      }

      await this.validateBeforeCommit(meaningfulChanges);
      await this.git(['add', '.']);
      await this.git(['commit', '-m', 'auto: iteration update']);
      logger.info('Git commit success');

      try {
        await this.git(['push']);
        logger.info('Git push success');
      } catch (pushError) {
        logger.error('Git push failed', pushError.stderr || pushError.message || pushError);
      }

      return true;
    } catch (error) {
      logger.error('Git integration failed', error.stderr || error.message || error);
      if ((error.stderr || error.message || '').includes('SyntaxError')) {
        logger.error('Syntax validation failed, commit dibatalkan');
      }
      return false;
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

    const decision = this.runOneImprovement();
    logger.info(`Decision taken: ${decision.action}`);

    const committed = await this.runGitIntegration();
    if (committed) {
      this.appendDevLog(decision.action, decision.details);
    }

    logger.info('Autonomous iteration completed');
  }

  scheduleNext() {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      Promise.resolve()
        .then(() => this.runOneIteration())
        .catch(async (error) => {
          logger.error('Autonomous iteration error', error);
          await this.rollbackLastCommit();
        })
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

    logger.info('Artificial loop prevention activated');
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
