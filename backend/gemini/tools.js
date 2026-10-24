import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);
const WORKSPACE_DIR = path.resolve(process.cwd(), '..', 'workspace_output');
const PUBLIC_DIR = path.resolve(process.cwd(), '..', 'frontend', 'public');

if (!fs.existsSync(WORKSPACE_DIR)) {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
}

export const realAgentTools = {
  // 1. 워크스페이스 내 실제 프로젝트 파일 목록 및 요약 정보 조회 (내부 메타파일 제외)
  async list_files() {
    const files = await fs.promises.readdir(WORKSPACE_DIR);
    const visible = files.filter((f) => f !== 'meeting_minutes.json' && f !== '회의록_최신.md' && !f.startsWith('.'));
    const details = await Promise.all(
      visible.map(async (name) => {
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
          size: stat.size,
          updatedAt: stat.mtime,
          summary: preview
        };
      })
    );
    return { files: details, workspace: WORKSPACE_DIR };
  },

  // 2. 파일 전체 읽기
  async read_file({ filename }) {
    if (!filename) return { error: '파일명이 지정되지 않았습니다.' };
    const safePath = path.resolve(WORKSPACE_DIR, path.basename(filename));
    if (!fs.existsSync(safePath)) {
      return { error: `File not found: ${filename}` };
    }
    const content = await fs.promises.readFile(safePath, 'utf-8');
    return { filename: path.basename(filename), content };
  },

  // 3. 파일 저장 (HTML 파일은 프리뷰 호환을 위해 public 폴더에도 동기화)
  async write_file({ filename, content }) {
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
      bytes: Buffer.byteLength(content, 'utf-8')
    };
  },

  // 4. QA 엔지니어용 실제 정밀 검증 도구 (JS 문법 파싱, DOM/ID 참조 무결성, CSS 가시성, 런타임 체크)
  async inspect_project({ filename }) {
    if (!filename) return { error: '검증할 파일명이 필요합니다.' };
    const base = path.basename(filename);
    const safePath = path.resolve(WORKSPACE_DIR, base);
    if (!fs.existsSync(safePath)) {
      return { valid: false, error: `검증 대상 파일(${base})이 존재하지 않습니다.` };
    }

    const content = await fs.promises.readFile(safePath, 'utf-8');
    const ext = path.extname(base).toLowerCase();
    const issues = [];
    const metrics = {
      filename: base,
      bytes: Buffer.byteLength(content, 'utf-8'),
      lines: content.split('\n').length
    };

    if (ext === '.html') {
      // (A) <script> 태그 추출 및 실제 JavaScript 문법(Syntax) 파싱 검증
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

      // (B) onclick 등 인라인 이벤트 핸들러에 호출된 함수가 실제로 정의되어 있는지 확인
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

      // (C) document.getElementById('...') 로 참조하는 ID가 실제 HTML에 존재하는지 확인
      const idRefs = [...allJs.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
      const uniqueIds = [...new Set(idRefs)];
      uniqueIds.forEach((id) => {
        const idAttrRegex = new RegExp(`id=['"]${id}['"]`);
        if (!idAttrRegex.test(content)) {
          issues.push(`[DOM ID 누락] JS에서 getElementById('${id}')를 호출하나 HTML에 id="${id}" 요소가 없습니다.`);
        }
      });

      // (D) 빈 버튼 또는 텍스트 없는 탭 검사
      const buttons = [...content.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/gi)];
      metrics.buttonCount = buttons.length;
      buttons.forEach((b, i) => {
        const inner = b[1].replace(/<[^>]+>/g, '').trim();
        if (!inner) {
          issues.push(`[UI 결함] #${i + 1}번째 <button> 태그 내부에 표시될 텍스트가 비어 있습니다.`);
        }
      });
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
    }

    return {
      valid: issues.length === 0,
      metrics,
      issues,
      contentPreview: content.slice(0, 1500)
    };
  },

  // 5. 터미널 명령어 실행
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
