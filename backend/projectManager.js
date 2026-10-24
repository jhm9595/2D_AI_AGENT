import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, '..');
export const WORKSPACE_DIR = path.resolve(ROOT_DIR, 'workspace_output');
export const PROJECTS_DIR = path.join(WORKSPACE_DIR, 'projects');
export const PUBLIC_DIR = path.resolve(ROOT_DIR, 'frontend', 'public');

export function ensureProjectsDir() {
  if (!fs.existsSync(WORKSPACE_DIR)) {
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  }
  if (!fs.existsSync(PROJECTS_DIR)) {
    fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  }
  const publicProjectsDir = path.join(PUBLIC_DIR, 'projects');
  if (fs.existsSync(PUBLIC_DIR) && !fs.existsSync(publicProjectsDir)) {
    fs.mkdirSync(publicProjectsDir, { recursive: true });
  }
}

let hasMigrated = false;

/**
 * 📦 기존 workspace_output 루트의 단일 파일들을 프로젝트별 구조로 마이그레이션 (1회만 수행)
 */
export async function migrateLegacyFiles() {
  if (hasMigrated) return;
  hasMigrated = true;
  ensureProjectsDir();

  const legacyGamePath = path.join(WORKSPACE_DIR, 'ksool_game.html');
  const ksoolDir = path.join(PROJECTS_DIR, 'ksool_game');

  if (fs.existsSync(legacyGamePath)) {
    const ksoolDocs = path.join(ksoolDir, 'docs');
    const ksoolData = path.join(ksoolDir, 'data');
    if (!fs.existsSync(ksoolDocs)) fs.mkdirSync(ksoolDocs, { recursive: true });
    if (!fs.existsSync(ksoolData)) fs.mkdirSync(ksoolData, { recursive: true });

    // index.html 복사
    const targetHtml = path.join(ksoolDir, 'index.html');
    if (!fs.existsSync(targetHtml)) {
      const gameContent = await fs.promises.readFile(legacyGamePath, 'utf-8');
      await fs.promises.writeFile(targetHtml, gameContent, 'utf-8');
    }

    // project.json 생성
    const metaPath = path.join(ksoolDir, 'project.json');
    if (!fs.existsSync(metaPath)) {
      const meta = {
        id: 'ksool_game',
        name: '한국의 술 도감 게임',
        description: '한국 전통주 및 지역 특산주 도감 수집 및 퀴즈 2D 인터랙티브 웹 게임',
        category: 'game',
        entrypoint: 'index.html',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await fs.promises.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
    }

    // docs/PRD.md 마이그레이션 (기존 ARCHITECTURE.md 활용)
    const prdPath = path.join(ksoolDocs, 'PRD.md');
    if (!fs.existsSync(prdPath)) {
      const archPath = path.join(WORKSPACE_DIR, 'ARCHITECTURE.md');
      let prdContent = '';
      if (fs.existsSync(archPath)) {
        prdContent = await fs.promises.readFile(archPath, 'utf-8');
      } else {
        prdContent = `# 📋 제품 기획서 (PRD): 한국의 술 도감 게임\n\n## 1. 개요\n한국의 전통주를 학습하고 도감에 수집하는 인터랙티브 웹 게임입니다.\n\n## 2. 주요 기능\n- 막걸리, 청주, 증류식 소주 등 주종별 상세 정보 카드\n- 인터랙티브 퀴즈 및 도감 완성률 게이지\n`;
      }
      await fs.promises.writeFile(prdPath, prdContent, 'utf-8');
    }

    // docs/WBS_PLAN.md 생성
    const wbsPath = path.join(ksoolDocs, 'WBS_PLAN.md');
    if (!fs.existsSync(wbsPath)) {
      const wbsContent = `# 🗂️ WBS 작업 분해 및 DAG 의존성 계획서: ksool_game\n\n- **총괄 PM**: 김수석\n- **마일스톤**: v1.0 정식 릴리스\n\n## 작업 분해 내역\n1. [DBA] 전통주 데이터 스키마 및 시드 데이터 작성 (schema_ddl.json)\n2. [BE] 전통주 검색/퀴즈 API 명세 정의\n3. [FE] 2D 도감 뷰어 및 퀴즈 인터랙션 렌더러 구현 (index.html)\n4. [Security] Gate 1 위협 모델링, Gate 2 SAST, Gate 4 DAST 검증\n5. [QA] Gate 3 E2E 기능 및 반응형 UI 회귀 테스트\n`;
      await fs.promises.writeFile(wbsPath, wbsContent, 'utf-8');
    }

    // data/schema_ddl.json 생성
    const ddlPath = path.join(ksoolData, 'schema_ddl.json');
    if (!fs.existsSync(ddlPath)) {
      const ddlContent = {
        tables: {
          traditional_drinks: {
            description: '한국 전통주 마스터 테이블',
            columns: [
              { name: 'id', type: 'VARCHAR(32)', primaryKey: true },
              { name: 'name', type: 'VARCHAR(100)', nullable: false },
              { name: 'category', type: 'VARCHAR(50)', description: '탁주 | 약주 | 청주 | 증류식소주' },
              { name: 'alcohol', type: 'DECIMAL(3,1)', unit: '%' },
              { name: 'region', type: 'VARCHAR(50)', description: '생산지' },
              { name: 'description', type: 'TEXT' }
            ]
          }
        },
        sampleSeedCount: 12
      };
      await fs.promises.writeFile(ddlPath, JSON.stringify(ddlContent, null, 2), 'utf-8');
    }

    // frontend/public/projects/ksool_game/index.html 동기화 (최초 1회만)
    try {
      const pubProjectDir = path.join(PUBLIC_DIR, 'projects', 'ksool_game');
      if (!fs.existsSync(pubProjectDir)) fs.mkdirSync(pubProjectDir, { recursive: true });
      const pubTarget = path.join(pubProjectDir, 'index.html');
      if (!fs.existsSync(pubTarget)) {
        const gameContent = await fs.promises.readFile(legacyGamePath, 'utf-8');
        await fs.promises.writeFile(pubTarget, gameContent, 'utf-8');
      }
    } catch (e) {}
  }
}

/**
 * 🔍 전체 프로젝트 목록 및 각 프로젝트별 분류된 산출물 파일 상세 조회
 */
export async function listProjectsWithArtifacts() {
  ensureProjectsDir();
  await migrateLegacyFiles();

  const entries = await fs.promises.readdir(PROJECTS_DIR, { withFileTypes: true });
  const projectDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  const projects = [];

  for (const pid of projectDirs) {
    const pPath = path.join(PROJECTS_DIR, pid);
    const metaPath = path.join(pPath, 'project.json');
    let meta = {
      id: pid,
      name: pid,
      description: 'AI 에이전트 프로젝트',
      category: 'web',
      entrypoint: 'index.html',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (fs.existsSync(metaPath)) {
      try {
        const raw = await fs.promises.readFile(metaPath, 'utf-8');
        meta = { ...meta, ...JSON.parse(raw) };
      } catch (e) {}
    }

    // 프로젝트 하위 파일 수집 및 분류 (docs, data, apps, root)
    const categorized = {
      apps: [],
      docs: [],
      data: [],
      others: []
    };

    async function scanDir(currentDir, relativePrefix = '') {
      if (!fs.existsSync(currentDir)) return;
      const items = await fs.promises.readdir(currentDir, { withFileTypes: true });
      for (const item of items) {
        if (item.name.startsWith('.')) continue;
        const full = path.join(currentDir, item.name);
        const rel = relativePrefix ? `${relativePrefix}/${item.name}` : item.name;

        if (item.isDirectory()) {
          await scanDir(full, rel);
        } else if (item.isFile()) {
          const stat = await fs.promises.stat(full);
          const fileInfo = {
            name: item.name,
            relPath: `projects/${pid}/${rel}`,
            subpath: rel,
            size: stat.size,
            updatedAt: stat.mtime,
            projectId: pid
          };

          if (item.name.endsWith('.html')) {
            categorized.apps.push(fileInfo);
          } else if (rel.startsWith('docs/') || item.name.endsWith('.md')) {
            categorized.docs.push(fileInfo);
          } else if (rel.startsWith('data/') || item.name.endsWith('.json') && item.name !== 'project.json') {
            categorized.data.push(fileInfo);
          } else if (item.name !== 'project.json') {
            categorized.others.push(fileInfo);
          }
        }
      }
    }

    await scanDir(pPath);

    // 정렬 (최신 수정 순)
    categorized.apps.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    categorized.docs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    categorized.data.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    projects.push({
      ...meta,
      projectPath: pPath,
      files: categorized
    });
  }

  projects.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return projects;
}

/**
 * 📝 특정 프로젝트 폴더 내 파일 저장
 */
export async function writeProjectArtifact(projectId, subpath, content) {
  ensureProjectsDir();
  const safeProjectId = path.basename(projectId);
  const pPath = path.join(PROJECTS_DIR, safeProjectId);
  const fullFilePath = path.resolve(pPath, subpath);

  // Path Traversal 방지
  if (!fullFilePath.startsWith(pPath)) {
    throw new Error('비정상적인 파일 경로 접근입니다.');
  }

  const dir = path.dirname(fullFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  await fs.promises.writeFile(fullFilePath, content, 'utf-8');

  // project.json updatedAt 갱신
  const metaPath = path.join(pPath, 'project.json');
  if (fs.existsSync(metaPath)) {
    try {
      const raw = await fs.promises.readFile(metaPath, 'utf-8');
      const meta = JSON.parse(raw);
      meta.updatedAt = new Date().toISOString();
      await fs.promises.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
    } catch (e) {}
  }

  // HTML 파일인 경우 public 폴더 및 레거시 루트에 동기화
  if (subpath.endsWith('.html')) {
    const pubProjectDir = path.join(PUBLIC_DIR, 'projects', safeProjectId);
    if (!fs.existsSync(pubProjectDir)) fs.mkdirSync(pubProjectDir, { recursive: true });
    try {
      await fs.promises.writeFile(path.join(pubProjectDir, path.basename(subpath)), content, 'utf-8');
      // 호환성을 위해 public 루트 및 workspace 루트에도 projectId.html 동기화
      await fs.promises.writeFile(path.join(PUBLIC_DIR, `${safeProjectId}.html`), content, 'utf-8');
      await fs.promises.writeFile(path.join(WORKSPACE_DIR, `${safeProjectId}.html`), content, 'utf-8');
    } catch (e) {}
  }

  return {
    projectId: safeProjectId,
    subpath,
    fullPath: fullFilePath,
    size: Buffer.byteLength(content, 'utf-8')
  };
}

/**
 * 📖 프로젝트 내부 파일 읽기
 */
export async function readProjectArtifact(projectId, subpath) {
  const safeProjectId = path.basename(projectId);
  const pPath = path.join(PROJECTS_DIR, safeProjectId);
  const fullFilePath = path.resolve(pPath, subpath);

  if (!fullFilePath.startsWith(pPath) || !fs.existsSync(fullFilePath)) {
    return null;
  }

  const content = await fs.promises.readFile(fullFilePath, 'utf-8');
  return {
    projectId: safeProjectId,
    subpath,
    fullPath: fullFilePath,
    content
  };
}

/**
 * 🏷️ 프로젝트 메타데이터(project.json) 생성 또는 업데이트
 */
export async function upsertProjectMeta(projectId, metaUpdates) {
  ensureProjectsDir();
  const safeProjectId = path.basename(projectId);
  const pPath = path.join(PROJECTS_DIR, safeProjectId);
  if (!fs.existsSync(pPath)) {
    fs.mkdirSync(pPath, { recursive: true });
  }

  const metaPath = path.join(pPath, 'project.json');
  let meta = {
    id: safeProjectId,
    name: safeProjectId,
    description: 'AI 에이전트 생성 프로젝트',
    category: 'web',
    entrypoint: 'index.html',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (fs.existsSync(metaPath)) {
    try {
      const raw = await fs.promises.readFile(metaPath, 'utf-8');
      meta = { ...meta, ...JSON.parse(raw) };
    } catch (e) {}
  }

  meta = { ...meta, ...metaUpdates, updatedAt: new Date().toISOString() };
  await fs.promises.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
  return meta;
}
