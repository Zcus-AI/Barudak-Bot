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

  buildDecision() {
    const plan = [
      'Feature Improvement',
      'Refactor Improvement',
      'Validation Improvement',
      'Error Handling Improvement',
      'Testing Improvement',
      'Logging Improvement'
    ];
    const action = plan[this.iterationCount % plan.length];
    return {
      action,
      details: `${action} via OpenClaw agent dengan batas perubahan <=200 baris.`
    };
  }

  buildImprovementPrompt(decision) {
    return [
      `You are autonomous dev iteration #${this.iterationCount} for project Barudak-Bot.`,
      `Jenis improvement: ${decision.action}.`,
      'WAJIB lakukan modifikasi file nyata di project (bukan hanya log internal).',
      'Targetkan perubahan kecil realistis untuk Discord bot (fitur kecil/refactor/validasi/error handling/test/logging).',
      'Batas maksimal perubahan sekitar 200 baris total.',
      'Jangan merusak project, jangan hapus fitur lama tanpa alasan kuat.',
      'Pastikan syntax valid, dan update dev_log.md hanya jika perubahan nyata dilakukan.',
      'Kerjakan langsung pada filesystem project ini.'
    ].join(' ');
  }

  invokeOpenClawAgent(decision) {
    const prompt = this.buildImprovementPrompt(decision);
    logger.info('Invoking OpenClaw agent');
    const result = spawnSync(
      'openclaw',
      ['agent', '--session-id', 'bc10d311-5885-494b-9592-ed2cded8e6ca', '-m', prompt],
      { cwd: process.cwd(), encoding: 'utf8' }
    );

    const stdout = (result.stdout || '').trim();
    const stderr = (result.stderr || '').trim();

    if (stdout) logger.info(`OpenClaw agent stdout: ${stdout}`);
    if (stderr) logger.warn(`OpenClaw agent stderr: ${stderr}`);

    if (result.status !== 0) {
      logger.error(`OpenClaw agent failed: ${stderr || stdout || `exit ${result.status}`}`);
      return false;
    }

    logger.info('OpenClaw agent finished');
    return true;
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

      const decision = this.buildDecision();
      logger.info(`Decision taken: ${decision.action}`);

      const agentOk = this.invokeOpenClawAgent(decision);
      if (!agentOk) {
        logger.warn('Skipping git flow because OpenClaw agent failed');
        logger.info('Autonomous iteration completed');
        return;
      }

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
