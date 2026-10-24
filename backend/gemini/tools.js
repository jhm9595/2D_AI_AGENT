import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import {
  ROOT_DIR,
  WORKSPACE_DIR,
  PROJECTS_DIR,
  PUBLIC_DIR,
  CORE_SYSTEM_ID,
  isForbiddenSystemPath,
  listProjectsWithArtifacts,
  writeProjectArtifact,
  readProjectArtifact,
  ensureProjectsDir
} from '../projectManager.js';

const execPromise = util.promisify(exec);
ensureProjectsDir();

/**
 * 🔍 파일 경로 해석 헬퍼 (프로젝트 내부 경로, projects/ 상대경로, 코어시스템 소스코드 완전 호환)
 */
function resolveSafeFilePath(filename, projectId = null) {
  if (!filename) return null;
  const clean = filename.replace(/^[/\\]+/, '').replace(/\.\./g, '');

  // 1. 코어시스템(core_system) 전용 경로 해석
  if (projectId === CORE_SYSTEM_ID || projectId === 'core_system') {
    if (clean.startsWith('docs/') || clean.endsWith('.md') || clean.startsWith('data/')) {
      return path.resolve(PROJECTS_DIR, CORE_SYSTEM_ID, clean);
    }
    if (clean.startsWith('src/')) {
      return path.resolve(ROOT_DIR, 'frontend', clean);
    }
    const directRoot = path.resolve(ROOT_DIR, clean);
    if (fs.existsSync(directRoot)) return directRoot;
    const feCandidate = path.resolve(ROOT_DIR, 'frontend', clean);
    if (fs.existsSync(feCandidate)) return feCandidate;
    const beCandidate = path.resolve(ROOT_DIR, 'backend', clean);
    if (fs.existsSync(beCandidate)) return beCandidate;
    return directRoot;
  }

  // 2. 일반 프로젝트 경로 해석
  if (projectId) {
    const projSafe = path.resolve(PROJECTS_DIR, path.basename(projectId), clean);
    if (projSafe.startsWith(PROJECTS_DIR)) return projSafe;
  }

  if (clean.startsWith('projects/') || clean.startsWith('projects\\')) {
    const relSafe = path.resolve(WORKSPACE_DIR, clean);
    if (relSafe.startsWith(WORKSPACE_DIR)) return relSafe;
  }

  const directPath = path.resolve(WORKSPACE_DIR, clean);
  if (fs.existsSync(directPath)) return directPath;

  // projects/{firstDir}/{clean} 폴더 내 존재하는지 검색
  if (fs.existsSync(PROJECTS_DIR)) {
    try {
      const dirs = fs.readdirSync(PROJECTS_DIR);
      for (const d of dirs) {
        const candidate = path.resolve(PROJECTS_DIR, d, clean);
        if (fs.existsSync(candidate)) return candidate;
        const subIndex = path.resolve(PROJECTS_DIR, d, 'index.html');
        if (clean === `${d}.html` && fs.existsSync(subIndex)) return subIndex;
      }
    } catch (e) {}
  }

  return directPath;
}

export const realAgentTools = {
  // 1. 프로젝트 목록 및 분류된 산출물 트리 조회
  async list_projects() {
    return await listProjectsWithArtifacts();
  },

  // 2. 워크스페이스 내 프로젝트 파일 및 루트 파일 목록 조회
  async list_files() {
    const projects = await listProjectsWithArtifacts();
    const rootFiles = await fs.promises.readdir(WORKSPACE_DIR);
    const visibleRoot = rootFiles.filter(
      (f) => f !== 'meeting_minutes.json' && f !== '회의록_최신.md' && f !== 'projects' && !f.startsWith('.')
    );

    const rootDetails = await Promise.all(
      visibleRoot.map(async (name) => {
        const fullPath = path.join(WORKSPACE_DIR, name);
        const stat = await fs.promises.stat(fullPath);
        let preview = '';
        try {
          const raw = await fs.promises.readFile(fullPath, 'utf-8');
          const titleMatch = raw.match(/<title>(.*?)<\/title>/i) || raw.match(/^#\s+(.*)$/m);
          preview = titleMatch ? titleMatch[1].trim() : raw.slice(0, 120).replace(/\s+/g, ' ');
        } catch (e) {}
        return {
          name,
          relPath: name,
          size: stat.size,
          updatedAt: stat.mtime,
          summary: preview
        };
      })
    );

    return {
      files: rootDetails,
      projects,
      workspace: WORKSPACE_DIR,
      projectsDir: PROJECTS_DIR
    };
  },

  // 3. 파일 읽기 (프로젝트 경로 자동 탐색)
  async read_file({ filename, projectId }) {
    if (!filename) return { error: '파일명이 지정되지 않았습니다.' };
    const safePath = resolveSafeFilePath(filename, projectId);
    if (!safePath || !fs.existsSync(safePath)) {
      return { error: `File not found: ${filename}` };
    }
    const content = await fs.promises.readFile(safePath, 'utf-8');
    return {
      filename: path.basename(safePath),
      relPath: path.relative(WORKSPACE_DIR, safePath).replace(/\\/g, '/'),
      fullPath: safePath,
      content
    };
  },

  // 4. 파일 저장 (프로젝트 분기 지원 & public 폴더 동기화)
  async write_file({ filename, content, projectId }) {
    if (!filename) return { error: '저장할 파일명이 지정되지 않았습니다.' };

    // (A) projectId가 명시된 경우 프로젝트 매니저를 통해 저장
    if (projectId) {
      const res = await writeProjectArtifact(projectId, filename, content);
      return {
        status: 'success',
        projectId,
        path: res.fullPath,
        subpath: res.subpath,
        relPath: `projects/${projectId}/${res.subpath}`,
        bytes: res.size
      };
    }

    // (B) 파일명이 projects/로 시작하는 경우 프로젝트 파싱 후 저장
    const clean = filename.replace(/^[/\\]+/, '').replace(/\\/g, '/');
    if (clean.startsWith('projects/')) {
      const parts = clean.split('/');
      const parsedProjectId = parts[1];
      const subpath = parts.slice(2).join('/');
      if (parsedProjectId && subpath) {
        const res = await writeProjectArtifact(parsedProjectId, subpath, content);
        return {
          status: 'success',
          projectId: parsedProjectId,
          path: res.fullPath,
          subpath: res.subpath,
          relPath: clean,
          bytes: res.size
        };
      }
    }

    // (C) 일반 루트 저장 (기존 호환)
    const base = path.basename(filename);
    const safePath = path.resolve(WORKSPACE_DIR, base);
    await fs.promises.writeFile(safePath, content, 'utf-8');

    if (base.endsWith('.html') && fs.existsSync(PUBLIC_DIR)) {
      try {
        await fs.promises.writeFile(path.resolve(PUBLIC_DIR, base), content, 'utf-8');
      } catch (e) {}
    }

    return {
      status: 'success',
      path: safePath,
      filename: base,
      relPath: base,
      bytes: Buffer.byteLength(content, 'utf-8')
    };
  },

  // 5. 정밀 정적/구문 검증 도구 (프로젝트 경로 자동 탐색)
  async inspect_project({ filename, projectId }) {
    if (!filename) return { error: '검증할 파일명이 필요합니다.' };
    const safePath = resolveSafeFilePath(filename, projectId);
    if (!safePath || !fs.existsSync(safePath)) {
      return { valid: false, error: `검증 대상 파일(${filename})이 존재하지 않습니다.` };
    }

    const content = await fs.promises.readFile(safePath, 'utf-8');
    const base = path.basename(safePath);
    const ext = path.extname(base).toLowerCase();
    const issues = [];
    const metrics = {
      filename: base,
      relPath: path.relative(WORKSPACE_DIR, safePath).replace(/\\/g, '/'),
      bytes: Buffer.byteLength(content, 'utf-8'),
      lines: content.split('\n').length
    };

    if (ext === '.html') {
      const scriptBlocks = [...content.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
      metrics.scriptBlockCount = scriptBlocks.length;
      scriptBlocks.forEach((match, idx) => {
        const jsCode = match[1];
        try {
          new Function(jsCode);
        } catch (syntaxErr) {
          issues.push(`[치명적 JS 문법 오류] <script> #${idx + 1}: ${syntaxErr.message}`);
        }
      });

      const inlineCalls = [...content.matchAll(/on\w+="([a-zA-Z0-9_$]+)\(/g)].map((m) => m[1]);
      const uniqueCalls = [...new Set(inlineCalls)];
      const allJs = scriptBlocks.map((m) => m[1]).join('\n');
      uniqueCalls.forEach((fnName) => {
        if (fnName === 'alert' || fnName === 'confirm' || fnName === 'console') return;
        const fnRegex = new RegExp(`(?:function\\s+${fnName}\\b|(?:const|let|var)\\s+${fnName}\\s*=)`);
        if (!fnRegex.test(allJs)) {
          issues.push(`[핸들러 누락] HTML에서 ${fnName}()를 호출하고 있으나 <script> 내에 정의되어 있지 않습니다.`);
        }
      });

      const idRefs = [...allJs.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
      const uniqueIds = [...new Set(idRefs)];
      uniqueIds.forEach((id) => {
        const idAttrRegex = new RegExp(`id=['"]${id}['"]`);
        if (!idAttrRegex.test(content)) {
          issues.push(`[DOM ID 누락] JS에서 getElementById('${id}')를 호출하나 HTML에 id="${id}" 요소가 없습니다.`);
        }
      });

      const buttons = [...content.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/gi)];
      metrics.buttonCount = buttons.length;
      buttons.forEach((b, i) => {
        const inner = b[1].replace(/<[^>]+>/g, '').trim();
        if (!inner) {
          issues.push(`[UI 결함] #${i + 1}번째 <button> 태그 내부에 표시될 텍스트가 비어 있습니다.`);
        }
      });
    } else if (ext === '.ts' || ext === '.tsx' || (projectId === CORE_SYSTEM_ID && safePath.includes('frontend'))) {
      // 🌟 [코어시스템 안전 조치]: 실제 Vite / TypeScript 컴파일 빌드 무결성 검증!
      const checkRes = await this.run_command({ command: 'npm run build --prefix frontend' });
      if (checkRes.error || (checkRes.stderr && !checkRes.stdout.includes('built in'))) {
        const errorOut = (checkRes.stdout || checkRes.stderr || checkRes.error).replace(/\r?\n/g, ' ');
        issues.push(`[코어시스템 TypeScript 빌드 오류] ${errorOut.slice(0, 400)}`);
      }
    } else if (ext === '.js' || ext === '.mjs') {
      try {
        new Function(content);
      } catch (syntaxErr) {
        issues.push(`[JS 문법 오류] ${syntaxErr.message}`);
      }
      const checkRes = await this.run_command({ command: `node --check "${safePath}"` });
      if (checkRes.error || checkRes.stderr) {
        issues.push(`[Node 실행 검증 오류] ${checkRes.stderr || checkRes.error}`);
      }
    } else if (ext === '.json') {
      try {
        JSON.parse(content);
      } catch (jsonErr) {
        issues.push(`[JSON 구문 오류] ${jsonErr.message}`);
      }
    }

    return {
      valid: issues.length === 0,
      metrics,
      issues,
      contentPreview: content.slice(0, 1500)
    };
  },

  // 6. 터미널 명령어 실행
  async run_command({ command }) {
    try {
      const { stdout, stderr } = await execPromise(command, {
        cwd: WORKSPACE_DIR,
        timeout: 10000,
        shell: 'powershell.exe'
      });
      return {
        command,
        stdout: stdout ? stdout.slice(0, 2000) : '',
        stderr: stderr ? stderr.slice(0, 2000) : ''
      };
    } catch (err) {
      return {
        command,
        error: err.message,
        stderr: err.stderr ? err.stderr.slice(0, 1000) : ''
      };
    }
  }
};
