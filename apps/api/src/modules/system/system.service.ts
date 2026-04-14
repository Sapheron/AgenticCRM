import { Injectable, Logger } from '@nestjs/common';
import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// ── Types ─────────────────────────────────────────────────────────────────────

interface VersionInfo {
  version: string;
  commitHash: string;
  commitDate: string;
  branch: string;
}

interface LatestInfo {
  commitHash: string;
  commitDate: string;
  message: string;
  author: string;
}

interface UpdateCheck {
  current: VersionInfo;
  latest: LatestInfo | null;
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

// GitHub API response shape (only fields we need)
interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string };
    committer: { date: string };
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const GITHUB_REPO = 'Sapheron/Open-Agent-CRM';
const GITHUB_BRANCH = 'main';
const VERSION_FILE = 'version.json'; // baked at build time
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ── Semver comparison ─────────────────────────────────────────────────────────

/**
 * Returns positive if a > b, negative if a < b, 0 if equal.
 * Handles "1.2.3" style strings. Non-numeric parts are treated as 0.
 */
function compareSemver(a: string, b: string): number {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * SystemService — works in both Docker containers (no git) and local dev (has git).
 *
 * Version detection:
 *   1. Try reading `version.json` (baked at Docker build time)
 *   2. Fall back to git commands (dev environment)
 *   3. Fall back to package.json version
 *
 * Update checking:
 *   - Uses GitHub REST API (no git needed)
 *
 * Triggering updates:
 *   - Runs update.sh on the host install dir (mounted into the container)
 */
@Injectable()
export class SystemService {
  private readonly logger = new Logger(SystemService.name);
  private readonly hostDir: string; // host install dir mounted into container
  private readonly versionInfo: VersionInfo;

  private updateStatus: UpdateStatus = { isUpdating: false, lastUpdate: null };
  private cachedCheck: UpdateCheck | null = null;
  private cacheExpiry = 0;

  constructor() {
    // In production Docker: /opt/openagentcrm is mounted at /host
    // Env var INSTALL_DIR tells us where the host repo lives
    this.hostDir = process.env.HOST_INSTALL_DIR || process.env.INSTALL_DIR || '/opt/openagentcrm';
    this.versionInfo = this.detectVersion();
    this.logger.log(`Version: v${this.versionInfo.version} (${this.versionInfo.commitHash})`);
  }

  // ── Version ────────────────────────────────────────────────────────────────

  getVersion(): VersionInfo {
    return this.versionInfo;
  }

  // ── Check for Updates (via GitHub API) ─────────────────────────────────────

  async checkForUpdate(): Promise<UpdateCheck> {
    if (this.cachedCheck && Date.now() < this.cacheExpiry) {
      return this.cachedCheck;
    }

    const current = this.versionInfo;

    try {
      // 1. Fetch the remote package.json to get the released version number.
      //    Using raw.githubusercontent instead of the API avoids rate-limit headers.
      const pkgUrl = `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/package.json`;
      const pkgRes = await fetch(pkgUrl, {
        headers: { 'User-Agent': 'OpenAgentCRM-Updater' },
        signal: AbortSignal.timeout(10_000),
      });

      if (!pkgRes.ok) {
        this.logger.warn(`Failed to fetch remote package.json: ${pkgRes.status}`);
        return this.noUpdateResult(current);
      }

      const remotePkg = (await pkgRes.json()) as { version?: string };
      const remoteVersion = remotePkg.version ?? '0.0.0';

      // Update is available only when the remote version is strictly greater
      // than the installed version. Pushing test commits doesn't matter —
      // only bumping package.json version triggers the update banner.
      const updateAvailable = compareSemver(remoteVersion, current.version) > 0;

      let latest: LatestInfo | null = null;
      if (updateAvailable) {
        // 2. Fetch latest commit metadata for the changelog message/author.
        const commitUrl = `https://api.github.com/repos/${GITHUB_REPO}/commits/${GITHUB_BRANCH}`;
        const commitRes = await fetch(commitUrl, {
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'OpenAgentCRM-Updater',
          },
          signal: AbortSignal.timeout(10_000),
        }).catch(() => null);

        if (commitRes?.ok) {
          const data = (await commitRes.json()) as GitHubCommit;
          latest = {
            commitHash: data.sha.substring(0, 7),
            commitDate: data.commit.committer.date,
            message: `v${remoteVersion} — ${data.commit.message.split('\n')[0]}`,
            author: data.commit.author.name,
          };
        } else {
          latest = {
            commitHash: 'unknown',
            commitDate: new Date().toISOString(),
            message: `v${remoteVersion} is available`,
            author: '',
          };
        }
      }

      const result: UpdateCheck = { current, latest, updateAvailable, checkedAt: new Date().toISOString() };
      this.cachedCheck = result;
      this.cacheExpiry = Date.now() + CACHE_TTL;
      return result;
    } catch (err) {
      this.logger.warn(`Failed to check for updates: ${err}`);
      return this.noUpdateResult(current);
    }
  }

  // ── Trigger Update ─────────────────────────────────────────────────────────

  async triggerUpdate(): Promise<{ ok: boolean; message: string }> {
    if (this.updateStatus.isUpdating) {
      return { ok: false, message: 'An update is already in progress' };
    }

    // Try host-mounted path first, then local
    const candidates = [
      path.join('/host', 'deploy', 'update.sh'),
      path.join(this.hostDir, 'deploy', 'update.sh'),
    ];

    let updateScript: string | null = null;
    for (const c of candidates) {
      if (fs.existsSync(c)) { updateScript = c; break; }
    }

    if (!updateScript) {
      return { ok: false, message: 'Update script not found. Make sure the install directory is mounted.' };
    }

    this.updateStatus.isUpdating = true;
    this.updateStatus.lastUpdate = { startedAt: new Date().toISOString(), success: false, log: '' };
    this.cachedCheck = null;

    const installDir = updateScript.replace('/deploy/update.sh', '');

    const child = spawn('bash', [updateScript], {
      cwd: installDir,
      env: { ...process.env, INSTALL_DIR: installDir },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    let log = '';
    const appendLog = (data: Buffer) => {
      log += data.toString();
      if (this.updateStatus.lastUpdate) this.updateStatus.lastUpdate.log = log;
    };

    child.stdout.on('data', appendLog);
    child.stderr.on('data', appendLog);

    child.on('close', (code) => {
      this.updateStatus.isUpdating = false;
      if (this.updateStatus.lastUpdate) {
        this.updateStatus.lastUpdate.completedAt = new Date().toISOString();
        this.updateStatus.lastUpdate.success = code === 0;
        this.updateStatus.lastUpdate.log = log;
      }
      this.logger.log(`Update process exited with code ${code}`);
    });

    child.unref();

    return { ok: true, message: 'Update started. The system will restart automatically.' };
  }

  // ── Update Status ──────────────────────────────────────────────────────────

  getUpdateStatus(): UpdateStatus {
    return this.updateStatus;
  }

  // ── Changelog (commits between current and latest) ─────────────────────────

  async getChangelog(): Promise<Array<{ hash: string; date: string; message: string; author: string }>> {
    try {
      const currentHash = this.versionInfo.commitHash;
      if (currentHash === 'unknown') return [];

      // Fetch recent commits from GitHub API
      const url = `https://api.github.com/repos/${GITHUB_REPO}/commits?sha=${GITHUB_BRANCH}&per_page=30`;
      const res = await fetch(url, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'OpenAgentCRM-Updater',
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) return [];

      const commits = (await res.json()) as GitHubCommit[];

      // Return all commits until we find the current one
      const changelog: Array<{ hash: string; date: string; message: string; author: string }> = [];
      for (const c of commits) {
        const shortHash = c.sha.substring(0, 7);
        if (shortHash === currentHash) break;
        changelog.push({
          hash: shortHash,
          date: c.commit.committer.date,
          message: c.commit.message.split('\n')[0],
          author: c.commit.author.name,
        });
      }

      return changelog;
    } catch {
      return [];
    }
  }

  // ── Private: Version Detection ─────────────────────────────────────────────

  private detectVersion(): VersionInfo {
    // 1. Try version.json (baked at Docker build time)
    for (const base of ['/app', process.cwd(), this.hostDir]) {
      try {
        const vPath = path.join(base, VERSION_FILE);
        if (fs.existsSync(vPath)) {
          const data = JSON.parse(fs.readFileSync(vPath, 'utf8'));
          if (data.commitHash && data.commitHash !== 'unknown') {
            return {
              version: data.version || '0.0.0',
              commitHash: data.commitHash,
              commitDate: data.commitDate || new Date().toISOString(),
              branch: data.branch || 'main',
            };
          }
        }
      } catch { /* skip */ }
    }

    // 2. Try git (dev environment)
    try {
      const root = execSync('git rev-parse --show-toplevel', { encoding: 'utf8', timeout: 5000 }).trim();
      const commitHash = execSync(`git -C "${root}" rev-parse --short HEAD`, { encoding: 'utf8', timeout: 5000 }).trim();
      const commitDate = execSync(`git -C "${root}" log -1 --format=%cI`, { encoding: 'utf8', timeout: 5000 }).trim();
      const branch = execSync(`git -C "${root}" rev-parse --abbrev-ref HEAD`, { encoding: 'utf8', timeout: 5000 }).trim();
      const version = this.readPkgVersion(root);
      return { version, commitHash, commitDate, branch };
    } catch { /* no git available */ }

    // 3. Fallback
    return {
      version: this.readPkgVersion('/app') || this.readPkgVersion(process.cwd()),
      commitHash: 'unknown',
      commitDate: new Date().toISOString(),
      branch: 'unknown',
    };
  }

  private readPkgVersion(dir: string): string {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      return pkg.version ?? '0.0.0';
    } catch {
      return '0.0.0';
    }
  }

  private noUpdateResult(current: VersionInfo): UpdateCheck {
    return { current, latest: null, updateAvailable: false, checkedAt: new Date().toISOString() };
  }
}
