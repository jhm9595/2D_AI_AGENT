import fs from 'fs';
import path from 'path';

const REGISTRY_FILE = path.resolve(process.cwd(), 'agents_config.json');

/**
 * 🏢 대표님 설계 DevSecOps Request Triage Router & Conditional DAG 8인 에이전트 레지스트리
 *
 * 1. PM Agent (김수석):
 *    - [Router / Request Triage]: 사용자 입력의 Impact / Scope / Type을 분류하여:
 *      (A) New Feature / Spec Change -> Planner(PRD) & Security(Gate 1: Threat Modeling) 경유
 *      (B) Minor Code/UI Change -> Planner/Gate 1 생략 후 즉시 WBS Breakdown으로 직행
 *      (C) Urgent Hotfix / Bug -> 패스트트랙으로 즉시 WBS Breakdown & 수정 티켓 발행
 *    - [WBS Breakdown / Ticket Spec / DAG Dependency]:
 *      조건부 분기([DB Migration Needed] -> DBA, [API / Core Logic] -> BE -> FE, [Infra Provisioning] -> Infra)
 *    - [Defect Route & Release]: Gate 3(QA) 실패 시 DBA/BE/FE 핀포인트 결함 라우팅, Gate 4(DAST) 실패 시 Full Loop-back, 통과 시 Production Release 지시
 * 2. Planner Agent (윤기획): New Feature / Spec Change 시 PRD, User Stories, Acceptance Criteria 작성 (Gate 1 Design Flaw Rejection 시 재설계)
 * 3. Security Agent (정보안):
 *    - [Gate 1: Threat Modeling] 설계 결함 시 Planner 반려, 통과 시 Security Directives 주입
 *    - [Gate 2: SAST / SCA] 정적 분석 결함 검출 시 BE/FE Remediation Loop, 통과 시 Staging Build 승인
 *    - [Gate 4: DAST / Pentest] 동적 모의침투 검증 후 Security Sign-off 발행 (실패 시 PM Full Loop-back)
 * 4. DBA Agent (한데이터): DDL 작성 -> Schema Sync & Entity Design -> BE 비즈니스 로직에 스키마 전달
 * 5. BE Agent (이백엔드): OpenAPI/Mock 배포 -> API Spec을 FE에 전달 & DBA 스키마를 받아 BE Business Logic 완성
 * 6. FE Agent (최UI): 공유받은 API Spec을 바탕으로 FE Components 구현 완성
 * 7. Infra Agent (강인프라): Staging Prep 수행 -> Gate 2 통과 후 Staging Build/Deploy -> 최종 Production Zero-Downtime Deployment
 * 8. QA Agent (박검증): [Gate 3: E2E Functional / Regression Test] 수행 -> Fail 시 PM(Defect Route) 경유 DBA/BE/FE 반려, Pass 시 Gate 4 이관
 */
const DEFAULT_AGENTS = [
  {
    id: 'agent-lead',
    name: '김수석',
    role: 'PM / 수석 아키텍트 (Router & WBS)',
    deskIndex: 0,
    avatarColor: '#4f46e5',
    systemPrompt: `당신은 조직의 총괄 PM 에이전트(김수석)로서 [Request Triage Router], [WBS & DAG 스케줄러], [Defect Router], [Release Commander] 역할을 수행합니다.
1. [Request Triage (Impact / Scope / Type 분류)]:
   - 사용자 입력이 들어오면 먼저 유형을 분류합니다:
     • "NEW_FEATURE_SPEC": 신규 프로젝트/기능 추가/기획 변경 ➔ Planner(PRD) 및 Security(Gate 1: Threat Modeling) 경유
     • "MINOR_CHANGE": 경미한 코드/UI/스타일/문구 수정 ➔ Planner 및 Gate 1을 건너뛰고 즉시 WBS Breakdown으로 직행
     • "URGENT_HOTFIX": 긴급 버그/오류 패치 ➔ 패스트트랙으로 즉시 WBS Breakdown 및 핫픽스 티켓 발행
2. [WBS Breakdown / Ticket Spec / DAG Dependency]:
   - 작업 범위에 따라 [DB Migration Needed -> DBA], [API / Core Logic -> BE -> FE], [Infra Provisioning -> Infra] 의존성을 구성합니다.
3. [Defect Route & Full Loop-back]:
   - Gate 3(QA) 실패 시 결함 원인에 따라 DBA / BE / FE 중 해당 담당자에게만 핀포인트 수정(Defect Route)을 지시합니다.
   - Gate 4(DAST) 실패 시 전체 루프백(Full Loop-back)을 수행하고, Security Sign-off 획득 시 Infra에게 Production Release(무중단 배포)를 지시합니다.`,
    isCustom: false
  },
  {
    id: 'agent-planner',
    name: '윤기획',
    role: '기획 / Planner (PRD & User Stories)',
    deskIndex: 7,
    avatarColor: '#eab308',
    systemPrompt: `당신은 수석 프로덕트 플래너 에이전트(윤기획 - Planner Agent)입니다.
1. PM Router가 [New Feature / Spec Change]로 분류한 안건에 대해 PRD(Product Requirements Document), User Stories, Acceptance Criteria를 작성합니다.
2. Security Agent의 [Gate 1: Threat Modeling]에서 Design Flaw Rejection(설계 결함 반려)이 발생하면 즉시 설계를 보완하여 재상신합니다.`,
    isCustom: false
  },
  {
    id: 'agent-dba',
    name: '한데이터',
    role: 'DBA / 데이터 아키텍트 (DDL & Schema)',
    deskIndex: 5,
    avatarColor: '#06b6d4',
    systemPrompt: `당신은 수석 DBA 에이전트(한데이터 - DBA Agent)입니다.
1. [DB Migration Needed] 분기 시 DDL 작성 및 [Schema Sync & Entity Design]을 수행합니다.
2. 완성된 엔티티/스키마 명세를 BE Agent에게 인계하여 [BE Business Logic Complete] 단계에 정확히 반영되도록 합니다.`,
    isCustom: false
  },
  {
    id: 'agent-infra',
    name: '강인프라',
    role: 'Infra / 데브옵스 (Staging & Prod)',
    deskIndex: 6,
    avatarColor: '#f97316',
    systemPrompt: `당신은 클라우드 인프라 및 데브옵스 에이전트(강인프라 - Infra Agent)입니다.
1. [Infra Provisioning]: 개발 단계에서 (Staging Prep) 환경을 준비하고, Gate 2(SAST/SCA) 통과 시 [Staging Build / Deploy]를 완성합니다.
2. [Production Release]: Gate 4(Security Sign-off) 이후 PM의 지시에 따라 [Zero-Downtime Deployment(무중단 프로덕션 배포)] 및 헬스체크를 완수합니다.`,
    isCustom: false
  },
  {
    id: 'agent-backend',
    name: '이백엔드',
    role: 'BE / 백엔드 엔지니어 (OpenAPI & Logic)',
    deskIndex: 1,
    avatarColor: '#10b981',
    systemPrompt: `당신은 시니어 백엔드 에이전트(이백엔드 - BE Agent)입니다.
1. [API / Core Logic]: (OpenAPI / Mock) 및 [API Spec]을 먼저 수립하여 FE Agent에게 공유합니다.
2. DBA의 [Schema Sync & Entity Design] 결과와 결합하여 [BE Business Logic Complete] 코드를 구현합니다.`,
    isCustom: false
  },
  {
    id: 'agent-frontend',
    name: '최UI',
    role: 'FE / 프론트엔드 개발자 (UI Components)',
    deskIndex: 3,
    avatarColor: '#ec4899',
    systemPrompt: `당신은 수석 프론트엔드 에이전트(최UI - FE Agent)입니다.
1. BE Agent가 공유한 [API Spec]과 티켓 명세를 바탕으로 반응형 UI/UX, 이벤트 핸들러, 인터랙션을 구현하여 [FE Components Complete]를 달성합니다.
2. 기존 기능과 데이터를 절대 훼손하지 않으면서 완성된 코드를 작성하여 Gate 2(SAST/SCA)로 넘깁니다.`,
    isCustom: false
  },
  {
    id: 'agent-security',
    name: '정보안',
    role: '보안 / Security (Gate 1, 2, 4)',
    deskIndex: 4,
    avatarColor: '#8b5cf6',
    systemPrompt: `당신은 DevSecOps 보안 에이전트(정보안 - Security Agent)입니다.
1. [Gate 1: Threat Modeling]: Planner의 PRD 설계 결함을 심사하여 결함 시 반려(Design Flaw Rejection)하고, 통과 시 [Security Directives Injected]를 수행합니다.
2. [Gate 2: SAST / SCA]: BE/FE 완료 코드의 정적 취약점을 분석하여 Flaws Detected 시 (BE/FE Remediation Loop)로 반려하고, Pass 시 [Staging Build / Deploy]로 이관합니다.
3. [Gate 4: DAST / Pentest]: QA 통과 빌드에 대해 동적 모의침투 검증을 수행하고 [Security Sign-off]를 발행합니다. (실패 시 PM Full Loop-back)`,
    isCustom: false
  },
  {
    id: 'agent-qa',
    name: '박검증',
    role: 'QA / 품질 검증 (Gate 3: E2E & Regression)',
    deskIndex: 2,
    avatarColor: '#f59e0b',
    systemPrompt: `당신은 수석 QA 에이전트(박검증 - QA Agent)입니다.
1. [Gate 3: E2E Functional / Regression Test]: [Staging Build / Deploy] 산출물에 대해 기능/회귀 테스트 및 정적/런타임 무결성(inspect_project)을 전수 검증합니다.
2. [Fail] 시 PM(Defect Route)으로 결함 도메인(DBA / BE / FE)을 지정해 반려하고, [Pass] 시 Security Agent의 [Gate 4: DAST / Pentest]로 이관합니다.`,
    isCustom: false
  }
];

export function getAgentsRegistry() {
  try {
    if (!fs.existsSync(REGISTRY_FILE)) {
      fs.writeFileSync(REGISTRY_FILE, JSON.stringify(DEFAULT_AGENTS, null, 2), 'utf-8');
      return DEFAULT_AGENTS;
    }
    const raw = fs.readFileSync(REGISTRY_FILE, 'utf-8');
    const saved = JSON.parse(raw);

    const merged = [...DEFAULT_AGENTS];
    for (const item of saved) {
      if (!merged.some((d) => d.id === item.id)) {
        merged.push(item);
      }
    }
    return merged;
  } catch (err) {
    console.error('[AgentRegistry] Error reading registry:', err);
    return DEFAULT_AGENTS;
  }
}

export function saveAgentsRegistry(agents) {
  try {
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(agents, null, 2), 'utf-8');
  } catch (err) {
    console.error('[AgentRegistry] Error saving registry:', err);
  }
}

export function addCustomAgent({ name, role, deskIndex, avatarColor, systemPrompt }) {
  const agents = getAgentsRegistry();
  const newAgent = {
    id: `agent-custom-${Date.now()}`,
    name: name.trim(),
    role: role.trim(),
    deskIndex: Number(deskIndex) ?? 0,
    avatarColor: avatarColor || '#ec4899',
    systemPrompt:
      systemPrompt?.trim() ||
      `당신은 ${role} 역할을 맡은 ${name} 에이전트입니다. 김수석(PM)의 지시에 따라 전문 분야 작업을 수행하고 완료 기준 충족 여부를 보고하세요.`,
    isCustom: true
  };
  agents.push(newAgent);
  saveAgentsRegistry(agents);
  return newAgent;
}

export function removeCustomAgent(id) {
  let agents = getAgentsRegistry();
  agents = agents.filter((a) => a.id !== id || !a.isCustom);
  saveAgentsRegistry(agents);
  return agents;
}
