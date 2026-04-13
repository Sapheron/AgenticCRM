import { Injectable, Logger } from '@nestjs/common';
import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface VersionInfo {
  version: string;
  commitHash: string;
  commitDate: string;
  branch: string;
}

interface UpdateCheck {
  current: VersionInfo;
  latest: {
    commitHash: string;
    commitDate: string;
    message: string;
    author: string;
  } | null;
  updateAvailable: boolean;
  checkedAt: string;
}

interface UpdateStatus {
  isUpdating: boolean;
  lastUpdate: {
    startedAt: string;
    completedAt?: string;
    success: boolean;
    log: string;
  } | null;
}

@Injectable()
export class SystemService {
  private readonly logger = new Logger(SystemService.name);
  private readonly repoDir: string;
  private readonly pkgVersion: string;

  private updateStatus: UpdateStatus = {
    isUpdating: false,
    lastUpdate: null,
  };

  private cachedCheck: UpdateCheck | null = null;
  private cacheExpiry = 0;
  private static readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor() {
    // In production: /opt/openagentcrm. In dev: project root.
    this.repoDir = process.env.INSTALL_DIR || this.findRepoRoot();
    this.pkgVersion = this.readPkgVersion();
  }

  // ── Version ────────────────────────────────────────────────────────────────

  getVersion(): VersionInfo {
    try {
      const commitHash = this.git('rev-parse --short HEAD');
      const commitDate = this.git('log -1 --format=%cI');
      const branch = this.git('rev-parse --abbrev-ref HEAD');
      return { version: this.pkgVersion, commitHash, commitDate, branch };
    } catch {
      return {
        version: this.pkgVersion,
        commitHash: 'unknown',
        commitDate: new Date().toISOString(),
        branch: 'unknown',
      };
    }
  }

  // ── Check for Updates ──────────────────────────────────────────────────────

  async checkForUpdate(): Promise<UpdateCheck> {
    if (this.cachedCheck && Date.now() < this.cacheExpiry) {
      return this.cachedCheck;
    }

    const current = this.getVersion();

    try {
      // Fetch latest from remote without merging
      this.git('fetch origin main --quiet');

      const localHash = this.git('rev-parse HEAD');
      const remoteHash = this.git('rev-parse origin/main');
      const updateAvailable = localHash !== remoteHash;

      let latest = null;
      if (updateAvailable) {
        const message = this.git('log origin/main -1 --format=%s');
        const author = this.git('log origin/main -1 --format=%an');
        const commitDate = this.git('log origin/main -1 --format=%cI');
        const commitHash = remoteHash.substring(0, 7);
        latest = { commitHash, commitDate, message, author };
      }

      const result: UpdateCheck = {
        current,
        latest,
        updateAvailable,
        checkedAt: new Date().toISOString(),
      };

      this.cachedCheck = result;
      this.cacheExpiry = Date.now() + SystemService.CACHE_TTL;
      return result;
    } catch (err) {
      this.logger.warn(`Failed to check for updates: ${err}`);
      // If git fetch fails (no network, etc.), return current version info
      return {
        current,
        latest: null,
        updateAvailable: false,
        checkedAt: new Date().toISOString(),
      };
    }
  }

  // ── Trigger Update ─────────────────────────────────────────────────────────

  async triggerUpdate(): Promise<{ ok: boolean; message: string }> {
    if (this.updateStatus.isUpdating) {
      return { ok: false, message: 'An update is already in progress' };
    }

    const updateScript = path.join(this.repoDir, 'deploy', 'update.sh');
    if (!fs.existsSync(updateScript)) {
      return { ok: false, message: 'Update script not found. Is this a production install?' };
    }

    this.updateStatus.isUpdating = true;
    this.updateStatus.lastUpdate = {
      startedAt: new Date().toISOString(),
      success: false,
      log: '',
    };

    // Invalidate cache so next check sees fresh state
    this.cachedCheck = null;

    // Run update in background — the process will restart containers
    const child = spawn('bash', [updateScript], {
      cwd: this.repoDir,
      env: { ...process.env, INSTALL_DIR: this.repoDir },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    let log = '';

    child.stdout.on('data', (data: Buffer) => {
      log += data.toString();
      if (this.updateStatus.lastUpdate) {
        this.updateStatus.lastUpdate.log = log;
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      log += data.toString();
      if (this.updateStatus.lastUpdate) {
        this.updateStatus.lastUpdate.log = log;
      }
    });

    child.on('close', (code) => {
      this.updateStatus.isUpdating = false;
      if (this.updateStatus.lastUpdate) {
        this.updateStatus.lastUpdate.completedAt = new Date().toISOString();
        this.updateStatus.lastUpdate.success = code === 0;
        this.updateStatus.lastUpdate.log = log;
      }
      this.logger.log(`Update process exited with code ${code}`);
    });

    // Detach so the update can continue even if API restarts
    child.unref();

    return { ok: true, message: 'Update started. The system will restart automatically.' };
  }

  // ── Update Status ──────────────────────────────────────────────────────────

  getUpdateStatus(): UpdateStatus {
    return this.updateStatus;
  }

  // ── Changelog (recent commits not yet applied) ─────────────────────────────

  async getChangelog(): Promise<Array<{ hash: string; date: string; message: string; author: string }>> {
    try {
      this.git('fetch origin main --quiet');
      const localHash = this.git('rev-parse HEAD');
      const remoteHash = this.git('rev-parse origin/main');

      if (localHash === remoteHash) return [];

      const raw = this.git(`log ${localHash}..${remoteHash} --format=%h|||%cI|||%s|||%an`);
      if (!raw.trim()) return [];

      return raw
        .trim()
        .split('\n')
        .map((line) => {
          const [hash, date, message, author] = line.split('|||');
          return { hash, date, message, author };
        });
    } catch {
      return [];
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private git(cmd: string): string {
    return execSync(`git -C "${this.repoDir}" ${cmd}`, {
      encoding: 'utf8',
      timeout: 30_000,
    }).trim();
  }

  private findRepoRoot(): string {
    try {
      return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
    } catch {
      return process.cwd();
    }
  }

  private readPkgVersion(): string {
    try {
      const pkgPath = path.join(this.repoDir, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      return pkg.version ?? '0.0.0';
    } catch {
      return '0.0.0';
    }
  }
}
