import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, '..');
export const WORKSPACE_DIR = path.resolve(ROOT_DIR, 'workspace_output');
export const PROJECTS_DIR = path.join(WORKSPACE_DIR, 'projects');
export const PUBLIC_DIR = path.resolve(ROOT_DIR, 'frontend', 'public');

export const CORE_SYSTEM_ID = 'core_system';
export const CORE_SYSTEM_NAME = '코어시스템';

/**
 * 🛡️ 보호 대상 파일인지 검증 (Blacklist Guard)
 */
export function isForbiddenSystemPath(targetPath) {
  if (!targetPath) return true;
  const norm = targetPath.toLowerCase().replace(/\\/g, '/');
  return (
    norm.includes('/.git/') ||
    norm.endsWith('/.git') ||
    norm.includes('/.env') ||
    norm.endsWith('.env') ||
    norm.includes('/node_modules/')
  );
}

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
 * 📦 코어시스템 및 레거시 파일 초기화 (1회만 수행)
 */
export async function migrateLegacyFiles() {
  if (hasMigrated) return;
  hasMigrated = true;
  ensureProjectsDir();

  // =========================================================================
  // 1. ⚡ 코어시스템(core_system) 초기화 (무조건 맨 앞에 위치하는 시스템 자체 프로젝트)
  // =========================================================================
  const coreDir = path.join(PROJECTS_DIR, CORE_SYSTEM_ID);
  const coreDocs = path.join(coreDir, 'docs');
  const coreData = path.join(coreDir, 'data');
  if (!fs.existsSync(coreDocs)) fs.mkdirSync(coreDocs, { recursive: true });
  if (!fs.existsSync(coreData)) fs.mkdirSync(coreData, { recursive: true });

  const coreMetaPath = path.join(coreDir, 'project.json');
  if (!fs.existsSync(coreMetaPath)) {
    const coreMeta = {
      id: CORE_SYSTEM_ID,
      name: CORE_SYSTEM_NAME,
      description: '2D AI 에이전트 오피스 플랫폼 자체 소스코드 및 시스템 아키텍처 (자체 진화 및 유지보수)',
      category: 'core_system',
      entrypoint: 'frontend/src/App.tsx',
      isCoreSystem: true,
      createdAt: '2026-10-24T00:00:00.000Z',
      updatedAt: new Date().toISOString()
    };
    await fs.promises.writeFile(coreMetaPath, JSON.stringify(coreMeta, null, 2), 'utf-8');
  }

  const corePrdPath = path.join(coreDocs, 'PRD.md');
  if (!fs.existsSync(corePrdPath)) {
    const prd = `# 📋 제품 기획서 (PRD): 코어시스템 (2D_AI_AGENT)

- **프로젝트 명칭**: 코어시스템 (2D AI 에이전트 자율 오피스 플랫폼)
- **식별자**: \`core_system\`
- **유형**: 시스템 코어 소스코드 (자체 진화 및 메타 유지보수)
- **책임자**: 윤기획 (Planner Agent)

---
## 1. 개요 및 목적
본 프로젝트는 2D 픽셀 스타일 가상 오피스에서 8인의 전문 AI 에이전트(PM, 기획, 보안, DBA, BE, FE, Infra, QA)가 자율적으로 협업하고 시스템 자체를 개선·진화시키는 메인 플랫폼입니다.

## 2. 시스템 아키텍처 모듈
- **Frontend (\`frontend/src/\`)**:
  - \`OfficeCanvas.ts\`: HTML5 Canvas 기반 2D 픽셀 오피스 맵 & 8개 워크스테이션
  - \`ExecutiveMeetingBoard.tsx\`: 경영진 회의 브리핑 및 대표자 의사결정(Non-blocking HITL)
  - \`App.tsx\`: 메인 대시보드 및 프로젝트별 산출물 보관함(Project Artifacts Hub)
- **Backend (\`backend/\`)**:
  - \`geminiAgent.js\`: PM Router, 조건부 DAG 파이프라인, 4대 보안/QA 게이트웨이
  - \`projectManager.js\`: 코어시스템 및 개별 프로젝트 폴더/문서 관리
  - \`eventBroker.js\`: 1초 단위 실시간 하트비트 텔레메트리 & 웹소켓 브로드캐스팅

## 3. 핵심 안전 및 가드레일 수칙
1. 보호 대상 파일(\`.git/\`, \`.env\`, \`node_modules/\`)은 어떠한 경우에도 수정/삭제가 원천 차단됩니다.
2. 시스템 코드 수정 후 QA 박검증의 \`npm run build\`(TypeScript 컴파일 검증)를 통과해야만 실제 반영됩니다.
3. 빌드 실패 시 이전 정상 상태로 즉각 롤백(Rollback)합니다.
`;
    await fs.promises.writeFile(corePrdPath, prd, 'utf-8');
  }

  const coreWbsPath = path.join(coreDocs, 'WBS_PLAN.md');
  if (!fs.existsSync(coreWbsPath)) {
    const wbs = `# 🗂️ WBS 작업 분해 및 유지보수 계획서: 코어시스템

- **총괄 PM**: 김수석 (PM / Technical Lead)
- **대상**: 2D_AI_AGENT 코어 플랫폼 자체 소스코드
- **관리 모드**: Self-Evolution & Meta-Maintenance

---
## 1. DAG 파이프라인 흐름
\`\`\`text
[사용자 시스템 개선 지시]
       │
       ▼
 [PM Router: 코어시스템 분류] ➔ [Planner: 기능 PRD 수립] ➔ [Security Gate 1: 안전성 점검]
       │
       ▼
 [FE/BE 담당자: frontend/src/ 또는 backend/ 코드 수정]
       │
       ▼
 [Security Gate 2: SAST 검사] ➔ [QA Gate 3: npm run build 실제 컴파일 검증]
       │ (빌드 실패 시 ➔ 즉각 롤백 & 수정 지시)
       ▼ (빌드 성공 시)
 [Security Gate 4: 런타임 Sign-off] ➔ [Vite HMR 무중단 핫 리로드 완료]
\`\`\`
`;
    await fs.promises.writeFile(coreWbsPath, wbs, 'utf-8');
  }

  const coreSecPath = path.join(coreDocs, 'SECURITY_AUDIT.md');
  if (!fs.existsSync(coreSecPath)) {
    const sec = `# 🛡️ 보안 감사 보고서: 코어시스템

- **보안 책임자**: 정보안 (Security Agent)
- **상태**: ✅ PASS (Core Protected)

---
## 1. 보안 방어선 및 격리 규칙
- **환경변수 보호**: \`.env\` 파일 접근 및 변경 원천 차단
- **저장소 무결성**: \`.git/\` 디렉토리 임의 수정 차단
- **정적 코드 검사**: eval() 및 취약 API 호출 사전 차단
`;
    await fs.promises.writeFile(coreSecPath, sec, 'utf-8');
  }

  const coreQaPath = path.join(coreDocs, 'QA_REPORT.md');
  if (!fs.existsSync(coreQaPath)) {
    const qa = `# 🧪 QA 무결성 검증 성적서: 코어시스템

- **품질 관리자**: 박검증 (QA Engineer)
- **검증 방식**: 실제 Vite/TypeScript 컴파일러 실행 (\`npm run build --prefix frontend\`)
- **현재 판정**: ✅ PASS (TypeScript 무결점 통과)
`;
    await fs.promises.writeFile(coreQaPath, qa, 'utf-8');
  }

  // =========================================================================
  // 2. 기존 ksool_game 마이그레이션
  // =========================================================================
  const legacyGamePath = path.join(WORKSPACE_DIR, 'ksool_game.html');
  const ksoolDir = path.join(PROJECTS_DIR, 'ksool_game');

  if (fs.existsSync(legacyGamePath)) {
    const ksoolDocs = path.join(ksoolDir, 'docs');
    const ksoolData = path.join(ksoolDir, 'data');
    if (!fs.existsSync(ksoolDocs)) fs.mkdirSync(ksoolDocs, { recursive: true });
    if (!fs.existsSync(ksoolData)) fs.mkdirSync(ksoolData, { recursive: true });

    const targetHtml = path.join(ksoolDir, 'index.html');
    if (!fs.existsSync(targetHtml)) {
      const gameContent = await fs.promises.readFile(legacyGamePath, 'utf-8');
      await fs.promises.writeFile(targetHtml, gameContent, 'utf-8');
    }

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

    const wbsPath = path.join(ksoolDocs, 'WBS_PLAN.md');
    if (!fs.existsSync(wbsPath)) {
      const wbsContent = `# 🗂️ WBS 작업 분해 및 DAG 의존성 계획서: ksool_game\n\n- **총괄 PM**: 김수석\n- **마일스톤**: v1.0 정식 릴리스\n\n## 작업 분해 내역\n1. [DBA] 전통주 데이터 스키마 및 시드 데이터 작성 (schema_ddl.json)\n2. [BE] 전통주 검색/퀴즈 API 명세 정의\n3. [FE] 2D 도감 뷰어 및 퀴즈 인터랙션 렌더러 구현 (index.html)\n4. [Security] Gate 1 위협 모델링, Gate 2 SAST, Gate 4 DAST 검증\n5. [QA] Gate 3 E2E 기능 및 반응형 UI 회귀 테스트\n`;
      await fs.promises.writeFile(wbsPath, wbsContent, 'utf-8');
    }

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
 * (※ 코어시스템은 무조건 맨 앞(index 0)에 위치하도록 정렬)
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
    const isCore = pid === CORE_SYSTEM_ID;

    let meta = {
      id: pid,
      name: isCore ? CORE_SYSTEM_NAME : pid,
      description: isCore ? '2D AI 에이전트 오피스 플랫폼 자체 소스코드 (자체 진화 및 유지보수)' : 'AI 에이전트 프로젝트',
      category: isCore ? 'core_system' : 'web',
      entrypoint: isCore ? 'frontend/src/App.tsx' : 'index.html',
      isCoreSystem: isCore,
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

    // 코어시스템인 경우 실행 앱으로 현재 2D 오피스 플랫폼 등록
    if (isCore) {
      categorized.apps.push({
        name: '2D 에이전트 자율 오피스 (실행 중)',
        relPath: 'http://localhost:5173',
        subpath: 'frontend/src/App.tsx',
        size: 294000,
        updatedAt: meta.updatedAt,
        projectId: CORE_SYSTEM_ID,
        isLiveApp: true
      });
    }

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

          if (item.name.endsWith('.html') && !isCore) {
            categorized.apps.push(fileInfo);
          } else if (rel.startsWith('docs/') || item.name.endsWith('.md')) {
            categorized.docs.push(fileInfo);
          } else if (rel.startsWith('data/') || (item.name.endsWith('.json') && item.name !== 'project.json')) {
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
      projectPath: isCore ? ROOT_DIR : pPath,
      files: categorized
    });
  }

  // 🌟 핵심 요구사항: "코어시스템"은 무조건 맨 앞(index 0)에 위치!
  projects.sort((a, b) => {
    if (a.id === CORE_SYSTEM_ID || a.isCoreSystem) return -1;
    if (b.id === CORE_SYSTEM_ID || b.isCoreSystem) return 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  return projects;
}

/**
 * 📝 파일 저장 (코어시스템 소스코드 분기 및 블랙리스트 보호 지원)
 */
export async function writeProjectArtifact(projectId, subpath, content) {
  ensureProjectsDir();
  const safeProjectId = path.basename(projectId);
  const isCore = safeProjectId === CORE_SYSTEM_ID;

  let fullFilePath = '';

  if (isCore) {
    // 코어시스템의 docs 문서는 workspace_output/projects/core_system/docs 에 보관
    if (subpath.startsWith('docs/') || subpath.endsWith('.md') || subpath.startsWith('data/')) {
      const pPath = path.join(PROJECTS_DIR, CORE_SYSTEM_ID);
      fullFilePath = path.resolve(pPath, subpath);
    } else {
      // 실제 소스코드(frontend/, backend/) 수정인 경우 ROOT_DIR로 라우팅!
      fullFilePath = path.resolve(ROOT_DIR, subpath);

      // 🛡️ 블랙리스트 가드레일: .git, .env, node_modules 절대 변경 금지!
      if (isForbiddenSystemPath(fullFilePath)) {
        throw new Error(`[보안 가드레일 거부] 보호된 시스템 경로(${subpath})는 수정할 수 없습니다.`);
      }
    }
  } else {
    // 일반 프로젝트는 workspace_output/projects/{projectId}/ 내 저장
    const pPath = path.join(PROJECTS_DIR, safeProjectId);
    fullFilePath = path.resolve(pPath, subpath);
    if (!fullFilePath.startsWith(pPath)) {
      throw new Error('비정상적인 파일 경로 접근입니다.');
    }
  }

  const dir = path.dirname(fullFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  await fs.promises.writeFile(fullFilePath, content, 'utf-8');

  // project.json updatedAt 갱신
  const metaPath = path.join(PROJECTS_DIR, safeProjectId, 'project.json');
  if (fs.existsSync(metaPath)) {
    try {
      const raw = await fs.promises.readFile(metaPath, 'utf-8');
      const meta = JSON.parse(raw);
      meta.updatedAt = new Date().toISOString();
      await fs.promises.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
    } catch (e) {}
  }

  // 일반 프로젝트의 HTML 파일인 경우 public 폴더 및 레거시 루트에 동기화
  if (!isCore && subpath.endsWith('.html')) {
    const pubProjectDir = path.join(PUBLIC_DIR, 'projects', safeProjectId);
    if (!fs.existsSync(pubProjectDir)) fs.mkdirSync(pubProjectDir, { recursive: true });
    try {
      await fs.promises.writeFile(path.join(pubProjectDir, path.basename(subpath)), content, 'utf-8');
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
 * 📖 파일 읽기 (코어시스템 소스코드 분기 지원)
 */
export async function readProjectArtifact(projectId, subpath) {
  const safeProjectId = path.basename(projectId);
  const isCore = safeProjectId === CORE_SYSTEM_ID;

  let fullFilePath = '';
  if (isCore) {
    if (subpath.startsWith('docs/') || subpath.endsWith('.md') || subpath.startsWith('data/')) {
      fullFilePath = path.resolve(PROJECTS_DIR, CORE_SYSTEM_ID, subpath);
    } else {
      fullFilePath = path.resolve(ROOT_DIR, subpath);
    }
  } else {
    fullFilePath = path.resolve(PROJECTS_DIR, safeProjectId, subpath);
  }

  if (isForbiddenSystemPath(fullFilePath)) {
    return { error: '보호된 시스템 파일입니다.' };
  }

  if (!fs.existsSync(fullFilePath)) {
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
  const isCore = safeProjectId === CORE_SYSTEM_ID;
  const pPath = path.join(PROJECTS_DIR, safeProjectId);
  if (!fs.existsSync(pPath)) {
    fs.mkdirSync(pPath, { recursive: true });
  }

  const metaPath = path.join(pPath, 'project.json');
  let meta = {
    id: safeProjectId,
    name: isCore ? CORE_SYSTEM_NAME : safeProjectId,
    description: isCore ? '2D AI 에이전트 오피스 플랫폼 자체 소스코드' : 'AI 에이전트 생성 프로젝트',
    category: isCore ? 'core_system' : 'web',
    entrypoint: isCore ? 'frontend/src/App.tsx' : 'index.html',
    isCoreSystem: isCore,
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
