const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawnSync } = require('node:child_process');
const { promisify } = require('node:util');
const logger = require('../utils/logger');

const execFileAsync = promisify(execFile);

function safeResolve(relativePath) {
  return path.resolve(process.cwd(), relativePath);
}

class AutonomousEngine {
  constructor(options = {}) {
    this.controlPath = options.controlPath || safeResolve('control.json');
    this.devLogPath = options.devLogPath || safeResolve('dev_log.md');
    this.iterationDelayMs = Math.max(60000, Number(options.iterationDelayMs) || 60000);
    this.running = false;
    this.timer = null;
    this.iterationCount = 0;
    this.lastAutoCommitHash = null;
    this.ignoredFiles = new Set(['src/dev/autonomous-metrics.json', 'dev_log.md', 'control.json']);
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

  runGitCommand(args, label) {
    logger.info(`Running git command: git ${args.join(' ')}`);
    const result = spawnSync('git', args, {
      cwd: process.cwd(),
      encoding: 'utf8'
    });

    const stdout = (result.stdout || '').trim();
    const stderr = (result.stderr || '').trim();

    if (stdout) logger.info(`${label} stdout: ${stdout}`);
    if (stderr) logger.warn(`${label} stderr: ${stderr}`);

    if (result.status !== 0) {
      return { ok: false, stdout, stderr, status: result.status };
    }

    return { ok: true, stdout, stderr, status: result.status };
  }

  fileExists(relPath) {
    return fs.existsSync(safeResolve(relPath));
  }

  parseChangedFiles(statusOutput) {
    const files = [];
    for (const line of statusOutput.split('\n')) {
      if (!line.trim()) continue;
      const clean = line.startsWith('?? ') ? line.slice(3) : line.slice(3);
      if (clean.includes(' -> ')) {
        files.push(clean.split(' -> ')[1]);
      } else {
        files.push(clean);
      }
    }
    return files;
  }

  isInValidationScope(relPath) {
    if (!relPath.endsWith('.js')) return false;
    if (relPath === 'index.js') return true;
    if (relPath.startsWith('src/')) return true;
    if (relPath.startsWith('tests/')) return true;
    return false;
  }

  ensureUptimeCommand() {
    const rel = 'src/commands/uptime.js';
    if (this.fileExists(rel)) return null;

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
    fs.writeFileSync(safeResolve(rel), content);
    return { action: 'Feature Improvement', details: 'Menambahkan command /uptime.', changedFiles: [rel] };
  }

  ensureInteractionValidation() {
    const rel = 'src/events/interactionCreate.js';
    const fullPath = safeResolve(rel);
    if (!fs.existsSync(fullPath)) return null;

    const raw = fs.readFileSync(fullPath, 'utf8');
    if (raw.includes('Invalid command handler format')) return null;

    const target = "      const command = client.commands.get(interaction.commandName);\n      if (!command) return;\n\n";
    if (!raw.includes(target)) return null;

    const patched = raw.replace(
      target,
      "      const command = client.commands.get(interaction.commandName);\n      if (!command) return;\n      if (typeof command.execute !== 'function') {\n        logger.warn('Invalid command handler format');\n        return;\n      }\n\n"
    );

    fs.writeFileSync(fullPath, patched);
    return { action: 'Validation Improvement', details: 'Menambahkan validasi command.execute.', changedFiles: [rel] };
  }

  ensureUptimeTest() {
    const rel = 'tests/uptime-command.test.js';
    if (this.fileExists(rel)) return null;

    const content = `const assert = require('node:assert');
const cmd = require('../src/commands/uptime');

assert.strictEqual(cmd.data.name, 'uptime');
assert.strictEqual(typeof cmd.execute, 'function');
console.log('uptime-command.test.js passed');
`;
    fs.writeFileSync(safeResolve(rel), content);
    return { action: 'Testing Improvement', details: 'Menambahkan test /uptime.', changedFiles: [rel] };
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

    return { action: 'Refactor Improvement', details: 'Tidak ada task baru pada katalog saat ini.', changedFiles: [] };
  }

  async getMeaningfulChangedFiles() {
    logger.info('Running: git status --porcelain');
    const status = this.runGitCommand(['status', '--porcelain'], 'git status');
    const raw = status.stdout || '';
    logger.info(`git status raw output:\n${raw || '(empty)'}`);

    if (!raw.trim()) {
      logger.info('Git status empty');
      return [];
    }

    logger.info('Git changes detected');
    const files = this.parseChangedFiles(raw);
    return files.filter((f) => !this.ignoredFiles.has(f));
  }

  async validateBeforeCommit(changedFiles) {
    await execFileAsync('node', ['--check', safeResolve('index.js')], { cwd: process.cwd() });

    const targets = changedFiles.filter((file) => this.isInValidationScope(file));
    for (const file of targets) {
      const fullPath = safeResolve(file);
      if (!fs.existsSync(fullPath)) {
        logger.warn(`Validation skipped, file not found: ${file}`);
        continue;
      }
      logger.info(`Syntax validation path verified: ${fullPath}`);
      await execFileAsync('node', ['--check', fullPath], { cwd: process.cwd() });
    }
  }

  async rollbackLastCommit() {
    if (!this.lastAutoCommitHash) return;
    try {
      await this.git(['reset', '--hard', 'HEAD~1']);
      logger.error('Rollback executed due to runtime failure');
      this.lastAutoCommitHash = null;
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

      const addRes = this.runGitCommand(['add', '.'], 'git add');
      if (!addRes.ok) {
        logger.error(`Git add failed: ${addRes.stderr || addRes.stdout || 'unknown error'}`);
        return false;
      }
      logger.info('Git add success');

      const commitRes = this.runGitCommand(['commit', '-m', 'auto: iteration update'], 'git commit');
      if (!commitRes.ok) {
        const commitError = `${commitRes.stderr || commitRes.stdout || 'unknown error'}`;
        if (commitError.toLowerCase().includes('nothing to commit')) {
          logger.warn('Git commit failed: nothing to commit');
        } else {
          logger.error(`Git commit failed: ${commitError}`);
        }
        return false;
      }
      logger.info('Git commit success');

      const rev = this.runGitCommand(['rev-parse', '--short', 'HEAD'], 'git rev-parse');
      if (rev.ok) this.lastAutoCommitHash = (rev.stdout || '').trim();

      let pushRes = this.runGitCommand(['push'], 'git push');
      if (!pushRes.ok) {
        const branchRes = this.runGitCommand(['rev-parse', '--abbrev-ref', 'HEAD'], 'git current-branch');
        const branch = branchRes.ok && branchRes.stdout ? branchRes.stdout.trim() : 'main';
        logger.warn(`Git push failed, trying set-upstream for branch ${branch}`);
        pushRes = this.runGitCommand(['push', '--set-upstream', 'origin', branch], 'git push set-upstream');
      }

      if (!pushRes.ok) {
        logger.error(`Git push failed: ${pushRes.stderr || pushRes.stdout || 'unknown error'}`);
      } else {
        logger.info('Git push success');
      }

      return true;
    } catch (error) {
      logger.error('Git integration failed', error.stderr || error.message || error);
      return false;
    }
  }

  async runOneIteration() {
    this.iterationCount += 1;
    logger.info('Autonomous iteration started');

    try {
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
    } catch (error) {
      logger.error('Autonomous iteration error', error);
      await this.rollbackLastCommit();
    }
  }

  scheduleNext() {
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      await this.runOneIteration();
      this.scheduleNext();
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
