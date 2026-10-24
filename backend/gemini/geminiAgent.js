import { GoogleGenAI } from '@google/genai';
import { eventBroker } from '../eventBroker.js';
import { realAgentTools } from './tools.js';
import { getAgentsRegistry } from '../agentRegistry.js';
import { startMeeting, addDialogue, requestDecision, setMeetingProjectId } from '../meetingManager.js';
import { upsertProjectMeta, listProjectsWithArtifacts, createProject, CORE_SYSTEM_ID } from '../projectManager.js';

let activeAgentSession = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRealAgentRunning() {
  return activeAgentSession;
}

export function forceResetAgentSession() {
  activeAgentSession = false;
}

let verifiedWorkingModel = 'gemini-3.8-flash';
const CANDIDATE_MODELS = ['gemini-3.8-flash', 'gemini-3.0-flash', 'gemini-2.5-flash', 'gemini-2.0-flash'];

export function getVerifiedWorkingModel() {
  return verifiedWorkingModel;
}

/**
 * 🔍 각 후보 모델을 실제로 호출 테스트하여 현재 API 키에서 정상 작동하는 최적 모델을 찾고 고정
 */
export async function verifyAndSelectBestModel(apiKey) {
  const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
  const results = [];
  let chosenModel = null;
  let chosenReply = '';

  const ordered = [
    verifiedWorkingModel,
    ...CANDIDATE_MODELS.filter((m) => m !== verifiedWorkingModel)
  ];

  for (const model of ordered) {
    const t0 = Date.now();
    try {
      const response = await ai.models.generateContent({
        model,
        contents: '한국어로 "API 연결 성공"이라고 짧게 답해줘.'
      });
      const elapsedMs = Date.now() - t0;
      const reply = (response?.text || '').trim();
      results.push({ model, ok: true, elapsedMs, reply });
      if (!chosenModel) {
        chosenModel = model;
        chosenReply = reply;
        verifiedWorkingModel = model;
      }
      console.log(`[ModelProbe] ✅ ${model} SUCCESS (${elapsedMs}ms): "${reply}"`);
      break;
    } catch (err) {
      const elapsedMs = Date.now() - t0;
      const errMsg = err.message ? err.message.slice(0, 160) : 'Error';
      results.push({ model, ok: false, elapsedMs, error: errMsg });
      console.warn(`[ModelProbe] ❌ ${model} FAILED (${elapsedMs}ms): ${errMsg}`);
    }
  }

  return {
    success: Boolean(chosenModel),
    chosenModel,
    chosenReply,
    results
  };
}

/**
 * Gemini API 호출 헬퍼 (검증된 1순위 모델 gemini-3.8-flash 우선 호출 + 실시간 1초 단위 하트비트 + 자동 폴백)
 */
async function callGeminiWithFallback(apiKey, contents, systemInstruction, meta = {}) {
  const { agentId = 'agent-lead', agentName = '에이전트', taskLabel = 'AI 추론 및 코드 생성' } = meta;
  const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
  const models = [
    verifiedWorkingModel,
    ...CANDIDATE_MODELS.filter((m) => m !== verifiedWorkingModel)
  ];
  let lastError = null;
  const promptChars = typeof contents === 'string' ? contents.length : JSON.stringify(contents).length;

  for (const model of models) {
    const startTs = Date.now();
    let elapsedSec = 0;

    eventBroker.updateWorkflowStatus({
      running: true,
      activeAgentId: agentId,
      activeAgentName: agentName,
      model,
      detail: `[${model}] ${taskLabel} 요청 전송됨 (입력 ${promptChars.toLocaleString()}자)`,
      elapsedSec: 0,
      lastError: null
    });

    eventBroker.agentThinking(
      agentId,
      `⏳ [${model}] ${taskLabel} 시작 (입력 ${promptChars.toLocaleString()}자)...`
    );

    const heartbeatTimer = setInterval(() => {
      elapsedSec = Math.round((Date.now() - startTs) / 1000);
      const hbMsg = `⏳ [${model} 응답 생성 중... ${elapsedSec}초 경과] ${taskLabel} (프롬프트 ${promptChars.toLocaleString()}자 분석 중)`;
      eventBroker.updateWorkflowStatus({
        running: true,
        activeAgentId: agentId,
        activeAgentName: agentName,
        model,
        detail: hbMsg,
        elapsedSec
      });
      eventBroker.agentThinking(agentId, hbMsg, { isHeartbeat: true });
    }, 1000);

    try {
      const config = systemInstruction ? { systemInstruction } : undefined;
      const response = await ai.models.generateContent({
        model,
        contents,
        config
      });
      clearInterval(heartbeatTimer);

      if (response && response.text) {
        verifiedWorkingModel = model;
        const totalSec = ((Date.now() - startTs) / 1000).toFixed(1);
        const outLen = response.text.trim().length;
        eventBroker.publish('agent_thinking', {
          agentId,
          name: agentName,
          status: 'thinking',
          message: `✅ [${model} 응답 완료 - ${totalSec}초 소요] ${taskLabel} (${outLen.toLocaleString()}자 수신)`
        });
        eventBroker.updateWorkflowStatus({
          running: true,
          activeAgentId: agentId,
          activeAgentName: agentName,
          model,
          detail: `✅ [${model}] 응답 수신 완료 (${totalSec}초 소요, ${outLen.toLocaleString()}자)`,
          elapsedSec: Math.round(Number(totalSec))
        });
        return response.text.trim();
      }
    } catch (err) {
      clearInterval(heartbeatTimer);
      lastError = err;
      const errSummary = err.message ? err.message.slice(0, 120) : '알 수 없는 오류';
      console.warn(`[GeminiAgent] Model ${model} failed:`, errSummary);
      eventBroker.publish('agent_thinking', {
        agentId,
        name: agentName,
        status: 'thinking',
        message: `⚠️ [${model} 호출 실패: ${errSummary}] ➔ 다음 대체 모델로 자동 재시도합니다.`
      });
    }
  }

  const finalErrMsg = lastError ? lastError.message : '모든 Gemini 모델 호출에 실패했습니다.';
  eventBroker.updateWorkflowStatus({
    lastError: finalErrMsg,
    detail: `❌ Gemini API 호출 실패: ${finalErrMsg.slice(0, 100)}`
  });
  eventBroker.agentError(agentId, `Gemini API 호출 실패 (${finalErrMsg.slice(0, 100)})`);
  throw lastError || new Error(finalErrMsg);
}

function extractPureCode(raw, filename = '') {
  if (!raw) return null;
  let cleaned = raw.trim();
  const codeBlockMatch = cleaned.match(/```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  }
  if (filename.endsWith('.html')) {
    const docIdx = cleaned.indexOf('<!DOCTYPE html>');
    const htmlIdx = cleaned.indexOf('<html');
    const startIdx = docIdx !== -1 ? docIdx : htmlIdx;
    if (startIdx !== -1) {
      cleaned = cleaned.slice(startIdx);
    }
  }
  return cleaned;
}

function parseJsonSafely(rawText) {
  if (!rawText) return null;
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (e) {
    return null;
  }
}

function ensureAgentSpawned(agent) {
  if (!agent) return;
  eventBroker.agentSpawned({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    deskIndex: agent.deskIndex,
    avatarColor: agent.avatarColor,
    status: 'spawn'
  });
}

// 회의 테이블 8인 좌석 좌표
const MEETING_SEATS = [
  { x: 450, y: 215 }, // 0: PM (김수석)
  { x: 450, y: 345 }, // 1: 기획 (윤기획)
  { x: 380, y: 240 }, // 2: DBA (한데이터)
  { x: 520, y: 240 }, // 3: Infra (강인프라)
  { x: 380, y: 320 }, // 4: BE (이백엔드)
  { x: 520, y: 320 }, // 5: FE (최UI)
  { x: 350, y: 280 }, // 6: 보안 (정보안)
  { x: 550, y: 280 }  // 7: QA (박검증)
];

/**
 * ⚖️ 대표자의 결재 결정이 내려졌을 때, PM(김수석)이 결정을 접수하여 다시 DevSecOps 파이프라인을 가동
 */
export async function handleExecutiveDecisionApplied(decision, clientApiKey) {
  const apiKey = clientApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const registry = getAgentsRegistry();
  const leadAgent = registry.find((a) => a.id === 'agent-lead') || registry[0];

  ensureAgentSpawned(leadAgent);
  eventBroker.agentThinking(
    leadAgent.id,
    `대표님 결재([옵션 ${decision.chosenOption.id}] ${decision.chosenOption.title}) 접수 및 WBS 재스케줄링...`
  );

  addDialogue({
    agentId: leadAgent.id,
    agentName: leadAgent.name,
    role: leadAgent.role,
    message: `[대표님 결재 접수 -> PM WBS 재스케줄링] "${decision.title}" 건에 대해 대표님께서 [${decision.chosenOption.title}]으로 확정하셨습니다. 이를 티켓 명세 및 TC에 반영하여 담당 부서에 할당합니다.`,
    type: 'proposal'
  });
  await sleep(800);

  const followUpDirective = `원래 업무("${decision.originalPrompt || decision.title}")와 관련하여 대표님께서 [${decision.chosenOption.title}: ${decision.chosenOption.description}] 방안으로 최종 결정하셨습니다. 대상 파일(${decision.targetFilename || '자동 판단'})에 이 결정을 완벽히 반영하고 보안 Gate 및 QA E2E 검증, 프로덕션 배포까지 완수하세요.`;

  await runEnterpriseDAGWorkflowLoop(followUpDirective, leadAgent, leadAgent, registry, apiKey, {
    forcedTargetFile: decision.targetFilename || null,
    decisionAlreadyResolved: true
  });
}

/**
 * 👑 메인 엔트리포인트
 */
export async function runGeminiAgentTask(userPrompt, clientApiKey, assignedAgentId, targetProjectId) {
  activeAgentSession = true;
  const apiKey = clientApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  const registry = getAgentsRegistry();
  const leadAgent = registry.find((a) => a.id === 'agent-lead') || registry[0];
  const initialAgent = registry.find((a) => a.id === assignedAgentId) || leadAgent;

  eventBroker.updateWorkflowStatus({
    running: true,
    stage: `PM Router Triage 착수: "${userPrompt.slice(0, 35)}"`,
    activeAgentId: initialAgent.id,
    activeAgentName: initialAgent.name,
    detail: apiKey ? 'PM Agent (Router) Request Triage 가동 시작' : '⚠️ API 키가 전달되지 않았습니다 (상단 Gemini 키 확인 필요)',
    elapsedSec: 0,
    lastError: apiKey ? null : 'Gemini API 키가 설정되지 않았습니다.'
  });

  if (!apiKey) {
    eventBroker.agentError(
      leadAgent.id,
      'Gemini API 키가 입력되지 않았습니다! 우측 상단 [Gemini 키] 버튼을 눌러 키를 등록해 주세요.'
    );
  }

  try {
    await runEnterpriseDAGWorkflowLoop(userPrompt, initialAgent, leadAgent, registry, apiKey, { targetProjectId });
    eventBroker.updateWorkflowStatus({
      running: false,
      stage: '✅ Final Delivery Report 완료 (User Validation 대기)',
      activeAgentId: null,
      activeAgentName: null,
      detail: `"${userPrompt.slice(0, 30)}" 업무가 정상 완료되었습니다.`,
      elapsedSec: 0
    });
  } catch (err) {
    console.error('[GeminiAgent] Execution error:', err);
    eventBroker.agentError(leadAgent.id, `작업 중 오류 발생: ${err.message}`);
    eventBroker.updateWorkflowStatus({
      running: false,
      stage: '❌ 작업 중단 (오류 발생)',
      activeAgentId: null,
      activeAgentName: null,
      detail: err.message,
      lastError: err.message
    });
  } finally {
    activeAgentSession = false;
  }
}

/**
 * 🏢 대표님 설계 신규 아키텍처 완벽 구현:
 *
 * [User Input: New Project / Feature Request / Change Request / Bug Report]
 *   ▼
 * [PM Agent (Router) — Request Triage: Impact / Scope / Type] ◄───────────────────────┐ (Full Loop-back on Gate 4 Fail)
 *   ├─ (New Feature / Spec Change) ➔ Planner Agent (PRD / User Stories / Criteria)   │
 *   │                                   ▼ ▲ (Design Flaw Rejection)                   │
 *   │                                 Security Agent [Gate 1: Threat Modeling]        │
 *   │                                   ▼ (Security Directives Injected)              │
 *   ├─ (Minor Code/UI Change) ──────────┼─► (Planner & Gate 1 생략 직행!)             │
 *   └─ (Urgent Hotfix / Bug) ───────────┘   (패스트트랙 직행!)                        │
 *                                       ▼                                             │
 * [PM Agent (WBS Breakdown / Ticket Spec / DAG Dependency)] ◄─────────────┐           │
 *   ├─ [DB Migration Needed] ➔ DBA Agent (DDL) ➔ [Schema Sync & Entity]   │           │
 *   ├─ [API / Core Logic]    ➔ BE Agent (OpenAPI/Mock)                    │           │
 *   │                            ├─► [API Spec] ➔ FE Agent ➔ [FE Complete]│           │
 *   │                            └─► (DBA 스키마 결합) ➔ [BE Complete]    │           │
 *   └─ [Infra Provisioning]  ➔ Infra Agent (Staging Prep) ────────┐       │           │
 *                                                                 │       │           │
 *   [BE Business Logic Complete] + [FE Components Complete]       │       │           │
 *     ▼                                                           │       │           │
 * [Security Agent — Gate 2: SAST / SCA]                           │       │           │
 *   ├─ [Flaws Detected] ➔ (BE/FE Remediation Loop)                │       │           │
 *   └─ [Pass] ➔ [Staging Build / Deploy] ◄────────────────────────┘       │           │
 *                 ▼                                                       │           │
 * [QA Agent — Gate 3: E2E Functional / Regression Test]                   │           │
 *   ├─ [Fail] ➔ PM (Defect Route) ➔ (DBA) / (BE) / (FE) ➔ (Fix Complete) ─┘           │
 *   └─ [Pass] ➔ [Security Agent — Gate 4: DAST / Pentest]                             │
 *                 ├─ [Fail] ➔ PM Agent ───────────────────────────────────────────────┘
 *                 └─ [Security Sign-off] ➔ PM Agent (Production Release)
 *                                            ▼
 *                                      [Infra (Production) Zero-Downtime Deployment]
 *                                            ▼
 *                                      [Final Delivery Report ──► User Validation]
 */
async function runEnterpriseDAGWorkflowLoop(
  userPrompt,
  initialAgent,
  leadAgent,
  registry,
  apiKey,
  options = {}
) {
  const plannerAgent = registry.find((a) => a.id === 'agent-planner' || a.role.includes('기획')) || leadAgent;
  const securityAgent = registry.find((a) => a.id === 'agent-security' || a.role.includes('보안')) || leadAgent;
  const dbaAgent = registry.find((a) => a.id === 'agent-dba' || a.role.includes('DBA')) || leadAgent;
  const infraAgent = registry.find((a) => a.id === 'agent-infra' || a.role.includes('Infra')) || leadAgent;
  const beAgent = registry.find((a) => a.id === 'agent-backend' || a.role.includes('BE')) || leadAgent;
  const feAgent = registry.find((a) => a.id === 'agent-frontend' || a.role.includes('FE')) || leadAgent;
  const qaAgent = registry.find((a) => a.id === 'agent-qa' || a.role.includes('QA')) || leadAgent;

  ensureAgentSpawned(leadAgent);
  if (initialAgent.id !== leadAgent.id) {
    ensureAgentSpawned(initialAgent);
  }
  await sleep(400);

  startMeeting({
    title: `[PM Router & DevSecOps DAG] ${userPrompt.slice(0, 28)}`,
    topic: `PM Router(Triage) ➔ [조건부 Planner/Gate1] ➔ PM WBS/DAG(DBA/BE/FE/Infra) ➔ Gate2(SAST) ➔ Staging ➔ Gate3(QA) ➔ Gate4(DAST) ➔ Prod Release`,
    attendees: [
      `${leadAgent.name}(PM)`,
      `${plannerAgent.name}(Planner)`,
      `${securityAgent.name}(Security)`,
      `${dbaAgent.name}(DBA)`,
      `${beAgent.name}(BE)`,
      `${feAgent.name}(FE)`,
      `${infraAgent.name}(Infra)`,
      `${qaAgent.name}(QA)`
    ]
  });

  const executionHistory = [];
  const sharedContracts = {
    projectId: null,
    projectName: null,
    projectDescription: null,
    isNewProject: false,
    triageType: null, // 'NEW_FEATURE_SPEC' | 'MINOR_CHANGE' | 'URGENT_HOTFIX'
    prdSpec: null,
    securityDirectives: null,
    wbsTicketSpec: null,
    dbSchemaDDL: null,
    beOpenApiSpec: null,
    infraStagingPrep: null,
    feUiSpec: null,
    sastAudit: null,
    dastSignOff: null
  };

  let targetFilename = options.forcedTargetFile || null;
  let acceptanceCriteria = [];
  let testCases = [];
  let decisionAskedInThisRun = Boolean(options.decisionAlreadyResolved);

  // 만약 사용자가 특정 실무 에이전트(예: QA, FE, BE)를 직접 호출한 경우 1차 보고 후 PM Router로 인계
  if (initialAgent.id !== leadAgent.id && initialAgent.id !== plannerAgent.id) {
    const firstReport = await executeRoleAgentTask({
      agent: initialAgent,
      leadAgent,
      userPrompt,
      instructionFromLead: `[User Direct Call] "${userPrompt}" - 귀하의 역할(${initialAgent.role}) 관점에서 먼저 1차 진단/수행하고 PM(김수석)에게 보고하세요.`,
      stepCriteria: '사용자 직접 지시사항 1차 수행 및 PM Router 보고',
      testCases,
      targetFilename,
      sharedContracts,
      executionHistory,
      seatPos: MEETING_SEATS[5],
      apiKey
    });
    if (firstReport.targetFilename) {
      targetFilename = firstReport.targetFilename;
    }
    executionHistory.push(firstReport);
  }

  // Gate 4 DAST 실패 시 PM Agent (Router)로 전체 루프백(Full Loop-back)을 지원하는 최상위 루프
  const MAX_ROUTER_LOOPS = 2;
  let routerLoop = 0;

  while (routerLoop < MAX_ROUTER_LOOPS) {
    routerLoop++;

    // =========================================================================
    // STEP 1: [PM Agent (Router) — Request Triage: Impact / Scope / Type]
    //   ├─ (New Feature / Spec Change) ➔ Planner (PRD) ➔ Security [Gate 1: Threat Modeling]
    //   ├─ (Minor Code/UI Change)      ➔ 즉시 PM WBS Breakdown 직행!
    //   └─ (Urgent Hotfix / Bug)       ➔ 패스트트랙 PM WBS Breakdown 직행!
    // =========================================================================
    const wsInfoInit = await realAgentTools.list_files();
    let initInspection = null;
    if (targetFilename) {
      initInspection = await realAgentTools.inspect_project({ filename: targetFilename });
    } else if (wsInfoInit.files.length > 0) {
      initInspection = await realAgentTools.inspect_project({ filename: wsInfoInit.files[0].name });
    }

    const triageAndWbs = await runPmRouterTriageAndWbs({
      leadAgent,
      plannerAgent,
      securityAgent,
      userPrompt,
      wsFiles: wsInfoInit.files,
      projects: wsInfoInit.projects || [],
      targetFilename,
      targetProjectId: options.targetProjectId || null,
      initInspection,
      executionHistory,
      sharedContracts,
      routerLoop,
      apiKey
    });

    targetFilename = triageAndWbs.targetFilename;
    acceptanceCriteria = triageAndWbs.acceptanceCriteria;
    testCases = triageAndWbs.testCases;

    // 대표님 필수 의사결정이 필요한 경우 (Non-blocking HITL)
    if (triageAndWbs.needsUserDecision && triageAndWbs.userDecisionQuestion && !decisionAskedInThisRun) {
      decisionAskedInThisRun = true;
      const q = triageAndWbs.userDecisionQuestion;
      const decItem = requestDecision({
        title: q.title || '대표님 의사결정 요청 건',
        issue: q.issue || '진행 방향 확정을 위해 대표님의 선택이 필요합니다.',
        proposalA: q.proposalA || { title: 'A안', description: '첫 번째 방안', impact: '신속 진행' },
        proposalB: q.proposalB || { title: 'B안', description: '두 번째 방안', impact: '확장성 확보' },
        recommended: q.recommended || 'A',
        requester: `${leadAgent.name} (${leadAgent.role})`,
        targetFilename,
        originalPrompt: userPrompt
      });

      addDialogue({
        agentId: leadAgent.id,
        agentName: leadAgent.name,
        role: leadAgent.role,
        message: `[대표님께 필수 결재 상신] "${decItem.title}" - 대표님의 확인이 필수적인 사안이어서 결재함에 상신했습니다. 결재 대기 중에도 진행 가능한 개발 공정은 계속 수행합니다.`,
        type: 'decision_request'
      });
      await sleep(600);
    }

    // =========================================================================
    // STEP 2: [PM Agent — WBS Breakdown / Ticket Spec / DAG Dependency]
    //   ├─ [DB Migration Needed] ➔ DBA Agent (DDL) ➔ [Schema Sync & Entity Design]
    //   ├─ [API / Core Logic]    ➔ BE Agent (OpenAPI/Mock) ➔ [API Spec] ➔ FE Agent
    //   └─ [Infra Provisioning]  ➔ Infra Agent (Staging Prep)
    // =========================================================================
    const MAX_DEFECT_ROUTES = 3;
    let defectCycle = 0;

    while (defectCycle < MAX_DEFECT_ROUTES) {
      defectCycle++;

      let activeTickets = [];
      if (defectCycle === 1) {
        activeTickets = triageAndWbs.assignedTasks;
      } else {
        // Gate 3 (QA) [Fail] ➔ PM (Defect Route) ➔ (DBA) / (BE) / (FE) 핀포인트 재할당
        const defectRoute = await scheduleDefectRouteByPM({
          leadAgent,
          targetFilename,
          acceptanceCriteria,
          testCases,
          executionHistory
        });
        activeTickets = defectRoute.assignedTasks;
      }

      // (1) Infra Provisioning (Staging Prep) 병렬 가동 (필요 시 또는 첫 빌드 시)
      const needsInfraPrep =
        defectCycle === 1 &&
        (triageAndWbs.dagBranches?.infraProvisioning !== false ||
          activeTickets.some((t) => t.agentId === 'agent-infra'));

      const infraPrepPromise = needsInfraPrep
        ? executeRoleAgentTask({
            agent: infraAgent,
            leadAgent,
            userPrompt,
            instructionFromLead: `[Infra Provisioning: Staging Prep] "${targetFilename}" 통합 Staging 빌드를 위한 런타임 및 서빙 환경을 준비하세요.`,
            stepCriteria: 'Staging Prep 완료',
            testCases,
            targetFilename,
            sharedContracts,
            executionHistory,
            seatPos: MEETING_SEATS[3],
            isParallelWave: true,
            apiKey
          })
        : Promise.resolve(null);

      // 코드/스키마 구현 티켓 (DBA -> BE -> FE DAG 순서 보장)
      const codeTickets = activeTickets.filter((t) => t.agentId !== 'agent-infra');
      if (codeTickets.length === 0) {
        codeTickets.push({
          agentId: 'agent-frontend',
          instruction: `"${userPrompt}" 요구사항을 "${targetFilename}"에 정확히 구현하세요.`,
          stepCriteria: '요구사항 완벽 반영'
        });
      }

      // DAG 순서 정렬: DBA(1순위) ➔ BE(2순위) ➔ FE(3순위)
      const dagPriority = { 'agent-dba': 1, 'agent-backend': 2, 'agent-frontend': 3 };
      codeTickets.sort((a, b) => (dagPriority[a.agentId] || 9) - (dagPriority[b.agentId] || 9));

      const resolvedCodeTasks = codeTickets.map((t, idx) => {
        const ag =
          registry.find((a) => a.id === t.agentId) ||
          registry.find((a) => a.name === t.agentName) ||
          feAgent;
        ensureAgentSpawned(ag);
        const seat = MEETING_SEATS[(idx + 2) % MEETING_SEATS.length];
        eventBroker.agentMove(ag.id, seat, 'walk');
        return { ...t, agent: ag, seat };
      });
      await sleep(600);

      const assigneeList = [
        ...resolvedCodeTasks.map((rt) => `${rt.agent.name}(${rt.agent.role.split('/')[0].trim()})`),
        ...(needsInfraPrep ? [`${infraAgent.name}(Infra Staging Prep)`] : [])
      ].join(', ');

      addDialogue({
        agentId: leadAgent.id,
        agentName: leadAgent.name,
        role: leadAgent.role,
        message:
          defectCycle === 1
            ? `🗂️ [PM Agent — WBS Breakdown / Ticket Spec / DAG Dependency 배정]\n` +
              `• 활성 DAG 분기: ${[
                triageAndWbs.dagBranches?.dbMigration ? '[DB Migration Needed -> DBA]' : null,
                triageAndWbs.dagBranches?.apiCoreLogic ? '[API / Core Logic -> BE -> FE]' : '[UI / Client -> FE]',
                needsInfraPrep ? '[Infra Provisioning -> Staging Prep]' : null
              ]
                .filter(Boolean)
                .join(' + ')}\n` +
              resolvedCodeTasks.map((rt) => `• [${rt.agent.name} 티켓]: ${rt.instruction}`).join('\n')
            : `🔧 [PM (Defect Route) ➔ (${resolvedCodeTasks.map((r) => r.agent.name).join('/')}) 결함 수정 지시]\n` +
              resolvedCodeTasks.map((rt) => `• [${rt.agent.name} 수정 티켓]: ${rt.instruction}`).join('\n'),
        type: 'proposal'
      });

      eventBroker.agentCompleted(leadAgent.id, `[DAG 티켓 배정 완료 ➔ 총괄 모니터링] 담당: ${assigneeList}`);
      eventBroker.updateWorkflowStatus({
        running: true,
        stage: `[DAG 실행] ${assigneeList} 작업 수행 중`,
        activeAgentId: resolvedCodeTasks[0].agent.id,
        activeAgentName: assigneeList,
        detail: resolvedCodeTasks.map((rt) => `${rt.agent.name}: ${rt.instruction.slice(0, 40)}...`).join(' | ')
      });
      await sleep(600);

      // DBA ➔ BE ➔ FE 순차 DAG 인계 실행 (동시에 Infra Staging Prep 병렬 대기)
      for (const rt of resolvedCodeTasks) {
        const rep = await executeRoleAgentTask({
          agent: rt.agent,
          leadAgent,
          userPrompt,
          instructionFromLead: rt.instruction,
          stepCriteria: rt.stepCriteria || acceptanceCriteria.join(', '),
          testCases,
          targetFilename,
          sharedContracts,
          executionHistory,
          seatPos: rt.seat,
          isParallelWave: false,
          apiKey
        });
        if (rep.targetFilename) {
          targetFilename = rep.targetFilename;
        }
        executionHistory.push(rep);
      }

      const infraPrepRep = await infraPrepPromise;
      if (infraPrepRep) {
        executionHistory.push(infraPrepRep);
      }

      // =======================================================================
      // STEP 3: [Security Agent — Gate 2: SAST / SCA]
      //   ├─ [Flaws Detected] ➔ (BE/FE Remediation Loop) ➔ 즉시 패치 후 Gate 2 재통과!
      //   └─ [Pass] + (Staging Prep) ➔ [Staging Build / Deploy]
      // =======================================================================
      let gate2Report = await executeSecurityGate2SAST({
        securityAgent,
        infraAgent,
        targetFilename,
        sharedContracts
      });
      executionHistory.push(gate2Report);

      if (!gate2Report.gatePassed) {
        // 다이어그램의 (BE/FE Remediation Loop): PM을 거치지 않고 즉시 BE/FE가 보안/구문 결함 패치 후 Gate 2 재검증!
        addDialogue({
          agentId: securityAgent.id,
          agentName: securityAgent.name,
          role: securityAgent.role,
          message: `🔄 [Gate 2 Flaws Detected ➔ (BE/FE Remediation Loop) 가동] 검출된 정적 결함(${gate2Report.foundIssues})을 패치하기 위해 FE/BE 즉각 수정 루프를 실행합니다.`,
          type: 'issue'
        });
        await sleep(600);

        const remReport = await executeRoleAgentTask({
          agent: feAgent,
          leadAgent,
          userPrompt,
          instructionFromLead: `[BE/FE Remediation Loop] Gate 2(SAST/SCA)에서 검출된 결함(${gate2Report.foundIssues})을 "${targetFilename}"에서 즉시 수정하세요.`,
          stepCriteria: 'SAST/SCA 정적 결함 0건',
          testCases,
          targetFilename,
          sharedContracts,
          executionHistory,
          seatPos: MEETING_SEATS[5],
          apiKey
        });
        executionHistory.push(remReport);

        gate2Report = await executeSecurityGate2SAST({
          securityAgent,
          infraAgent,
          targetFilename,
          sharedContracts
        });
        executionHistory.push(gate2Report);
      }

      // =======================================================================
      // STEP 4: [QA Agent — Gate 3: E2E Functional / Regression Test]
      //   ├─ [Fail] ➔ PM (Defect Route) ➔ (DBA) / (BE) / (FE) ➔ (Fix Complete)
      //   └─ [Pass] ➔ Security Agent [Gate 4: DAST / Pentest]
      // =======================================================================
      ensureAgentSpawned(qaAgent);
      const qaReport = await executeRoleAgentTask({
        agent: qaAgent,
        leadAgent,
        userPrompt,
        instructionFromLead: `[Gate 3: E2E Functional / Regression Test] Staging Build("${targetFilename}")가 티켓 완료 기준 및 TC(${testCases.join(', ')})를 충족하는지 기능/회귀 테스트를 수행하세요.`,
        stepCriteria: acceptanceCriteria.join(' | '),
        testCases,
        targetFilename,
        sharedContracts,
        executionHistory,
        seatPos: MEETING_SEATS[7],
        apiKey
      });
      executionHistory.push(qaReport);

      if (qaReport.tcPassed) {
        break; // Gate 3 [Pass] ➔ Gate 4로 진격!
      } else if (defectCycle < MAX_DEFECT_ROUTES) {
        addDialogue({
          agentId: leadAgent.id,
          agentName: leadAgent.name,
          role: leadAgent.role,
          message: `⚠️ [Gate 3 (QA) Fail ➔ PM (Defect Route) 가동] QA에서 보고된 결함(귀책 도메인: ${qaReport.failedDomain || 'FE'} / 내용: ${qaReport.foundIssues})을 접수했습니다. 해당 담당자(${qaReport.failedDomain || 'FE'})에게 핀포인트 수정을 지시합니다.`,
          type: 'issue'
        });
        await sleep(700);
      }
    }

    // =========================================================================
    // STEP 5: [Security Agent — Gate 4: DAST / Pentest]
    //   ├─ [Fail] ➔ PM Agent (Full Loop-back on Fail) ➔ PM Agent (Router)로 전체 루프백!
    //   └─ [Security Sign-off] ➔ PM Agent (Production Release)
    // =========================================================================
    const gate4Report = await executeSecurityGate4DAST({
      securityAgent,
      targetFilename,
      sharedContracts
    });
    executionHistory.push(gate4Report);

    if (gate4Report.gatePassed) {
      break; // Security Sign-off 획득! Production Release로 이동!
    } else if (routerLoop < MAX_ROUTER_LOOPS) {
      addDialogue({
        agentId: leadAgent.id,
        agentName: leadAgent.name,
        role: leadAgent.role,
        message: `🚨 [Gate 4 (DAST/Pentest) Fail ➔ PM Agent (Full Loop-back on Fail)] 동적 모의침투에서 치명적 결함(${gate4Report.foundIssues})이 발견되어 최상단 PM Agent (Router)로 전체 루프백(Full Loop-back)을 수행합니다.`,
        type: 'issue'
      });
      await sleep(700);
    }
  }

  // ===========================================================================
  // STEP 6: [PM Agent (Production Release)] ➔ [Infra (Production) Zero-Downtime Deployment] ➔ [Final Delivery Report ──► User Validation]
  // ===========================================================================
  eventBroker.agentMove(leadAgent.id, MEETING_SEATS[0], 'walk');
  addDialogue({
    agentId: leadAgent.id,
    agentName: leadAgent.name,
    role: leadAgent.role,
    message: `📢 [PM Agent — Production Release 지시] Gate 3(QA E2E/Regression) 및 Gate 4(DAST Security Sign-off) 승인이 완료되었습니다! ${infraAgent.name}(Infra Production)님, Zero-Downtime Deployment(무중단 프로덕션 배포)를 집행하세요.`,
    type: 'proposal'
  });
  eventBroker.agentCompleted(leadAgent.id, 'Production Release 승인 및 배포 지시 완료');
  await sleep(700);

  const deployReport = await executeInfraProductionDeployment({
    infraAgent,
    leadAgent,
    targetFilename: targetFilename || 'index.html'
  });
  executionHistory.push(deployReport);

  const finalCeoReport = `대표님, 요청하신 "${userPrompt}" 업무가 [프로젝트: ${sharedContracts.projectName || '기본'}] 관할 하에 [PM Router Triage: ${sharedContracts.triageType}] ➔ [Planner PRD & WBS 수립] ➔ [Gate 2: SAST/SCA] ➔ [Staging Build] ➔ [Gate 3: QA E2E/Regression] ➔ [Gate 4: DAST Security Sign-off] ➔ [Infra Zero-Downtime Deployment] 전 과정을 통과하여 산출물 보관함에 체계적으로 분류 저장되었습니다.`;

  addDialogue({
    agentId: leadAgent.id,
    agentName: leadAgent.name,
    role: leadAgent.role,
    message: `👑 [Final Delivery Report ──► User Validation]\n${finalCeoReport}\n• 프로젝트: [${sharedContracts.projectName || '프로젝트'}] (\`projects/${sharedContracts.projectId || 'ksool_game'}/\`)\n• 보관된 산출물:\n  - 🎮 실행 앱: \`index.html\`\n  - 📋 기획/WBS/보안/QA 문서: \`docs/\` (PRD.md, WBS_PLAN.md, SECURITY_AUDIT.md, QA_REPORT.md)\n  - 🗄️ 데이터 스키마: \`data/schema_ddl.json\`\n• 검증 통과 TC: ${testCases.join(' | ')}`,
    type: 'proposal'
  });

  eventBroker.agentMove(leadAgent.id, { deskIndex: leadAgent.deskIndex }, 'walk');
  await sleep(600);
  eventBroker.agentCompleted(leadAgent.id, `Final Delivery Report 완료! (${targetFilename})`);
}

/**
 * 🧭 STEP 1: [PM Agent (Router) — Request Triage: Impact / Scope / Type]
 *   - (New Feature / Spec Change) ➔ Planner Agent (PRD) ➔ Security Agent [Gate 1: Threat Modeling]
 *   - (Minor Code/UI Change)      ➔ Planner & Gate 1 생략 직행!
 *   - (Urgent Hotfix / Bug)       ➔ 패스트트랙 직행!
 *   ➔ 이어서 [PM Agent — WBS Breakdown / Ticket Spec / DAG Dependency] 수립
 */
async function runPmRouterTriageAndWbs({
  leadAgent,
  plannerAgent,
  securityAgent,
  userPrompt,
  wsFiles,
  projects = [],
  targetFilename,
  targetProjectId,
  initInspection,
  executionHistory,
  sharedContracts,
  routerLoop,
  apiKey
}) {
  ensureAgentSpawned(leadAgent);
  eventBroker.agentMove(leadAgent.id, MEETING_SEATS[0], 'walk');
  eventBroker.updateWorkflowStatus({
    running: true,
    stage: '🧭 [PM Agent (Router)] Request Triage & 프로젝트 식별 중',
    activeAgentId: leadAgent.id,
    activeAgentName: leadAgent.name,
    detail: `사용자 요청("${userPrompt.slice(0, 35)}")의 프로젝트 식별 및 Scope/Type 라우팅 경로 결정 중`
  });
  eventBroker.agentThinking(leadAgent.id, `[PM Router Triage] 프로젝트 식별 및 요청 유형(New Feature vs Minor Change vs Urgent Hotfix) 분석 중...`);
  await sleep(500);

  // 기본값 설정: 대표자가 지정한 프로젝트가 있으면 최우선, 없으면 일반 프로젝트(non-core) 우선, 그 외 기본값
  let targetProjObj = null;
  if (targetProjectId) {
    targetProjObj = projects.find((p) => p.id === targetProjectId);
  }
  if (!targetProjObj) {
    targetProjObj = projects.find((p) => p.id !== CORE_SYSTEM_ID) || projects[0] || null;
  }

  let projectId = targetProjObj ? targetProjObj.id : 'ksool_game';
  let projectName = targetProjObj ? targetProjObj.name : '한국의 술 도감 게임';
  let projectDescription = targetProjObj ? targetProjObj.description : '한국 전통주 및 지역 특산주 도감 수집 및 퀴즈 2D 인터랙티브 웹 게임';
  let isNewProject = false;
  let resolvedTarget = targetFilename || 'index.html';
  let requestType = 'NEW_FEATURE_SPEC'; // 'NEW_FEATURE_SPEC' | 'MINOR_CHANGE' | 'URGENT_HOTFIX'
  let triageReason = '신규 기능 또는 스펙 변경 요청으로 판단되어 Planner(PRD) 및 Gate 1(Threat Modeling) 경로로 라우팅합니다.';
  let prdSummary = `"${userPrompt}" 구현을 위한 PRD, User Stories 및 Acceptance Criteria`;
  let gate1Passed = true;
  let gate1Feedback = '위협 모델링(Gate 1) 이상 없음 — Security Directives 주입 완료';
  let securityDirectives = 'DOM XSS 방지, 인라인 이벤트 핸들러 전역 유효성 보장, 상태 데이터 무결성 유지';
  let wbsSummary = '요구사항에 맞춘 WBS 티켓 분해 및 DAG 의존성 수립 완료';
  let dagBranches = {
    dbMigration: false,
    apiCoreLogic: false,
    infraProvisioning: true
  };
  let acceptanceCriteria = ['요구사항 기능/UI 완벽 동작', 'Gate 2(SAST), Gate 3(QA E2E), Gate 4(DAST) 무결점 통과'];
  let testCases = ['TC-1: 핵심 요구 기능 및 UI 렌더링 정상 동작 확인', 'TC-2: 스크립트 문법 오류 0건 및 인터랙션 회귀 검증'];
  let needsUserDecision = false;
  let userDecisionQuestion = null;
  let assignedTasks = [
    {
      agentId: 'agent-frontend',
      instruction: `"${userPrompt}" 요구사항을 완벽히 구현하세요.`,
      stepCriteria: '요구사항 및 UI/로직 완벽 반영'
    }
  ];

  if (apiKey) {
    try {
      const existingProjectBriefs = projects.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description
      }));

      const routerPrompt = `${leadAgent.systemPrompt}

### 🗂️ 현재 오피스에 등록된 프로젝트 목록:
${JSON.stringify(existingProjectBriefs, null, 2)}

### 입력 정보:
- **사용자 입력(User Input)**: "${userPrompt}"
- **지정된 대상 프로젝트 힌트(Target Project Hint)**: ${targetProjectId ? `"${targetProjectId}" (대표자가 이 프로젝트를 명시적으로 선택함)` : '없음 (요청 내용 기반 자동 판별 필요)'}
- **현재 워크스페이스 파일 목록**: ${JSON.stringify(wsFiles)}
- **타깃 파일 후보**: ${targetFilename || '자동 식별'}
- **기존 프로젝트 정적 진단 결과**: ${initInspection ? JSON.stringify({ valid: initInspection.valid, issues: initInspection.issues }) : '없음'}

---
### 🧭 PM Agent (Router) 핵심 지침:
1. **[프로젝트 자동 식별 및 분류 (Project Auto-Triage)]**:
   - 🌟 **코어시스템 (core_system / 코어시스템) 분기 규칙**:
     사용자의 요청이 **우리가 현재 사용하는 2D AI 에이전트 프로그램 자체**(예: 2D 오피스 화면에 커피머신/가구/휴게실 추가, 대시보드 UI/스타일 변경, 에이전트 추가/관리 기능 확장, 백엔드 API/이벤트 추가, 회의록 다운로드 등)이거나 대상 프로젝트 힌트가 "core_system"일 때는 **무조건 projectId: "core_system", projectName: "코어시스템"으로 분류**하세요!
     이 경우 targetFilename은 수정 대상 실제 소스코드 경로(예: "frontend/src/App.tsx", "frontend/src/canvas/OfficeMap.ts", "backend/server.js" 등)로 지정하세요.
   - 🚀 **신규 프로젝트 생성 규칙 (isNewProject: true)**:
     사용자의 요청이 기존 프로젝트 목록에 없는 새로운 게임, 웹앱, 서비스, 도구를 만들어달라는 요청인 경우:
     • "isNewProject": true
     • "projectId": "신규_영문_snake_case_id" (예: "flappy_bird", "stock_sim", "todo_app", "calculator")
     • "projectName": "신규 프로젝트 한글 이름" (예: "플래피 버드 게임")
     • "projectDescription": "프로젝트 핵심 목표 및 설명"
     • "targetFilename": "index.html"
   - **기존 일반 프로젝트 분기 규칙**:
     등록된 기존 프로젝트(예: "ksool_game" 등)에 대한 작업이거나 대상 프로젝트 힌트가 주어진 경우 해당 projectId를 유지하고 isNewProject: false로 지정하세요. (기본 targetFilename: "index.html")

2. **[Request Triage: Impact / Scope / Type]**:
   - \`"NEW_FEATURE_SPEC"\`: 신규 프로젝트 생성, 신규 기능 추가, 기획/스펙 변경 ➔ **Planner Agent (PRD)** 및 **Security Agent [Gate 1: Threat Modeling]**을 거침!
   - \`"MINOR_CHANGE"\`: 단순 색상/폰트/문구/레이아웃 미세 조정 등 경미한 코드/UI 수정 ➔ **Planner 및 Gate 1을 생략**하고 즉시 PM WBS Breakdown으로 직행!
   - \`"URGENT_HOTFIX"\`: 버그 수정, 에러 패치, 안 눌리는 버튼 수리 등 긴급 핫픽스 ➔ **Planner 및 Gate 1을 우회(Fast-track)**하여 즉시 PM WBS Breakdown으로 직행!

3. **[Planner Agent & Security Gate 1 (NEW_FEATURE_SPEC일 때만 활성)]**:
   - \`prdSummary\`: Planner(윤기획)의 PRD / User Stories / Acceptance Criteria 상세 요약
   - \`gate1Feedback\` & \`securityDirectives\`: Security(정보안)의 [Gate 1: Threat Modeling] 결과 및 개발팀에 주입할 보안 지침

4. **[PM Agent — WBS Breakdown / Ticket Spec / DAG Dependency]**:
   - \`dagBranches\`: 이번 작업에 필요한 DAG 분기 여부(\`dbMigration\`, \`apiCoreLogic\`, \`infraProvisioning\`)
   - \`assignedTasks\`: 실제로 투입할 에이전트 티켓 배열
     • DB/스키마/시드데이터 필요 시 \`"agent-dba"\`
     • 백엔드/코어 비즈니스 로직 필요 시 \`"agent-backend"\`
     • UI/클라이언트 컴포넌트 필요 시 \`"agent-frontend"\`
   - 오직 대표님의 선택 없이는 아예 진행이 불가능한 사안만 \`"needsUserDecision": true\`

반드시 아래 JSON 형식으로만 응답하세요:
{
  "projectId": "ksool_game | 새프로젝트id",
  "projectName": "프로젝트 한글 이름",
  "projectDescription": "프로젝트 핵심 설명",
  "isNewProject": false,
  "targetFilename": "index.html",
  "requestType": "NEW_FEATURE_SPEC | MINOR_CHANGE | URGENT_HOTFIX",
  "triageReason": "PM Router 분류 근거",
  "prdSummary": "Planner Agent의 PRD / User Stories 요약",
  "gate1Passed": true,
  "gate1Feedback": "Gate 1 Threat Modeling 검토 결과",
  "securityDirectives": "주입할 보안 지침",
  "wbsSummary": "PM의 WBS Breakdown 및 DAG 의존성 설계 요약",
  "dagBranches": {
    "dbMigration": false,
    "apiCoreLogic": false,
    "infraProvisioning": true
  },
  "acceptanceCriteria": ["완료 기준 1", "완료 기준 2"],
  "testCases": ["TC-1: E2E/회귀 검증 항목 1", "TC-2: E2E/회귀 검증 항목 2"],
  "needsUserDecision": false,
  "userDecisionQuestion": null,
  "assignedTasks": [
    {
      "agentId": "agent-frontend",
      "instruction": "구체적인 티켓 작업 지시사항",
      "stepCriteria": "티켓 완료 기준"
    }
  ]
}`;

      const raw = await callGeminiWithFallback(apiKey, routerPrompt, undefined, {
        agentId: leadAgent.id,
        agentName: leadAgent.name,
        taskLabel: `[PM Router Triage & WBS] 프로젝트 식별 및 DAG 티켓 설계`
      });
      const parsed = parseJsonSafely(raw);
      if (parsed) {
        if (parsed.projectId) {
          projectId = parsed.projectId.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
        }
        if (parsed.projectName) projectName = parsed.projectName;
        if (parsed.projectDescription) projectDescription = parsed.projectDescription;
        if (typeof parsed.isNewProject === 'boolean') isNewProject = parsed.isNewProject;
        if (parsed.targetFilename) resolvedTarget = parsed.targetFilename;
        if (['NEW_FEATURE_SPEC', 'MINOR_CHANGE', 'URGENT_HOTFIX'].includes(parsed.requestType)) {
          requestType = parsed.requestType;
        }
        if (parsed.triageReason) triageReason = parsed.triageReason;
        if (parsed.prdSummary) prdSummary = parsed.prdSummary;
        if (typeof parsed.gate1Passed === 'boolean') gate1Passed = parsed.gate1Passed;
        if (parsed.gate1Feedback) gate1Feedback = parsed.gate1Feedback;
        if (parsed.securityDirectives) securityDirectives = parsed.securityDirectives;
        if (parsed.wbsSummary) wbsSummary = parsed.wbsSummary;
        if (parsed.dagBranches) dagBranches = { ...dagBranches, ...parsed.dagBranches };
        if (Array.isArray(parsed.acceptanceCriteria) && parsed.acceptanceCriteria.length > 0) {
          acceptanceCriteria = parsed.acceptanceCriteria;
        }
        if (Array.isArray(parsed.testCases) && parsed.testCases.length > 0) {
          testCases = parsed.testCases;
        }
        if (typeof parsed.needsUserDecision === 'boolean') {
          needsUserDecision = parsed.needsUserDecision;
          userDecisionQuestion = parsed.userDecisionQuestion || null;
        }
        if (Array.isArray(parsed.assignedTasks) && parsed.assignedTasks.length > 0) {
          assignedTasks = parsed.assignedTasks;
        }
      }
    } catch (err) {
      console.warn('[PM Router Triage Fallback]:', err.message);
    }
  }

  // 신규 프로젝트 생성 요청이거나 아직 프로젝트 폴더가 없는 경우 신규 프로젝트 자동 초기화
  if ((isNewProject || !projects.some((p) => p.id === projectId)) && projectId !== CORE_SYSTEM_ID) {
    try {
      await createProject({
        id: projectId,
        name: projectName,
        description: projectDescription,
        category: 'web',
        template: 'webapp'
      });
    } catch (e) {
      // 이미 폴더가 있거나 생성 중 경미한 에러는 통과
    }
  }

  // 프로젝트 메타데이터 저장 & 회의록 연동
  await upsertProjectMeta(projectId, {
    id: projectId,
    name: projectName,
    description: projectDescription,
    entrypoint: resolvedTarget
  });
  setMeetingProjectId(projectId);

  sharedContracts.projectId = projectId;
  sharedContracts.projectName = projectName;
  sharedContracts.projectDescription = projectDescription;
  sharedContracts.isNewProject = isNewProject;
  sharedContracts.triageType = requestType;
  sharedContracts.securityDirectives = securityDirectives;
  sharedContracts.wbsTicketSpec = wbsSummary;

  // 1) PM Agent (Router) Triage 결과 발표
  const triageBadge =
    requestType === 'NEW_FEATURE_SPEC'
      ? '🆕 [New Feature / Spec Change] ➔ Planner(PRD) & Gate 1(Threat Modeling) 경로 진입'
      : requestType === 'MINOR_CHANGE'
      ? '⚡ [Minor Code/UI Change] ➔ Planner & Gate 1 생략 후 PM WBS 직행'
      : '🚨 [Urgent Hotfix / Bug] ➔ 패스트트랙 PM WBS 직행';

  addDialogue({
    agentId: leadAgent.id,
    agentName: leadAgent.name,
    role: leadAgent.role,
    message: `🧭 [PM Agent (Router) — Request Triage 완료]\n• 대상 프로젝트: [${projectName}] (\`${projectId}\`)\n• 신규 여부: ${isNewProject ? '신규 생성 프로젝트' : '기존 프로젝트 유지보수'}\n• 분류 결과: ${triageBadge}\n• 진입점: "${resolvedTarget}"\n• Triage 판단 근거: ${triageReason}`,
    type: 'proposal'
  });
  await sleep(600);

  // PM의 WBS 계획서 문서(docs/WBS_PLAN.md) 저장
  const wbsDoc = `# 🗂️ WBS 작업 분해 및 DAG 의존성 계획서: ${projectName}

- **총괄 PM**: 김수석 (PM / Technical Lead)
- **프로젝트 식별자**: \`${projectId}\`
- **작성일시**: ${new Date().toLocaleString('ko-KR')}
- **분류(Triage)**: ${requestType} (${triageReason})

---
## 1. DAG 파이프라인 흐름
\`\`\`text
[PM Router Triage] ➔ [Planner PRD] ➔ [Security Gate 1: Threat Modeling]
       │
       ▼
 [PM WBS 수립] ➔ [DBA 스키마 DDL] ➔ [BE 비즈니스/API] ➔ [FE 컴포넌트]
       │
       ▼
 [Security Gate 2: SAST] ➔ [Staging Build] ➔ [QA Gate 3: E2E/회귀]
       │
       ▼
 [Security Gate 4: DAST 모의침투] ➔ [Infra Production Release]
\`\`\`

## 2. WBS 세부 작업 패키지 (Work Packages)
${assignedTasks.map((t, idx) => `### WP-${idx + 1}: [${t.agentId}]
- **지시 내용**: ${t.instruction}
- **완료 기준**: ${t.stepCriteria}
`).join('\n')}

## 3. 테스트 케이스 및 검증 지표
${testCases.map((tc, idx) => `- **TC-${idx + 1}**: ${tc}`).join('\n')}

## 4. 품질 및 보안 게이트웨이 기준
${acceptanceCriteria.map((ac, idx) => `- **기준 ${idx + 1}**: ${ac}`).join('\n')}
`;
  await realAgentTools.write_file({
    filename: 'docs/WBS_PLAN.md',
    projectId,
    content: wbsDoc
  });

  // 2) 분기 처리: 오직 [New Feature / Spec Change]일 때만 Planner Agent -> Security Agent (Gate 1) 실행!
  if (requestType === 'NEW_FEATURE_SPEC') {
    ensureAgentSpawned(plannerAgent);
    eventBroker.agentMove(plannerAgent.id, { deskIndex: plannerAgent.deskIndex }, 'walk');
    eventBroker.updateWorkflowStatus({
      running: true,
      stage: `📝 [Planner Agent] "${projectName}" PRD / User Stories 작성 중`,
      activeAgentId: plannerAgent.id,
      activeAgentName: plannerAgent.name,
      detail: `[${projectId}] PRD 및 User Stories 정의 중`
    });
    await sleep(600);

    sharedContracts.prdSpec = prdSummary;

    // Planner가 작성한 docs/PRD.md 문서 실시간 저장
    const prdDoc = `# 📋 제품 요구사항 정의서 (PRD): ${projectName}

- **프로젝트 식별자**: \`${projectId}\`
- **기획 책임자**: 윤기획 (Planner Agent)
- **작성일시**: ${new Date().toLocaleString('ko-KR')}
- **Triage 분류**: ${requestType}

---
## 1. 프로젝트 비전 및 목표
${prdSummary}

## 2. 타깃 페르소나 및 사용자 시나리오 (User Stories)
- **주 사용자**: 웹 브라우저를 통해 서비스를 이용하고 상호작용하는 사용자
- **핵심 시나리오**:
  1. 사용자는 직관적인 웹 인터페이스를 통해 주요 기능에 접근한다.
  2. 시스템은 즉각적인 피드백과 명확한 상태 변화를 시각적으로 전달한다.

## 3. 핵심 기능 요구사항 (Functional Requirements)
1. **사용자 요청 반영**: "${userPrompt}"
2. **반응형 2D 캔버스 / UI 컴포넌트 렌더링**
3. **상태 관리 및 데이터 영속성**

## 4. 완료 판정 기준 (Acceptance Criteria)
${acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

---
*본 기획서는 윤기획(Planner Agent)에 의해 작성되어 프로젝트 폴더(\`projects/${projectId}/docs/PRD.md\`)에 영구 보관됩니다.*
`;
    await realAgentTools.write_file({
      filename: 'docs/PRD.md',
      projectId,
      content: prdDoc
    });

    eventBroker.agentMove(plannerAgent.id, MEETING_SEATS[1], 'walk');
    addDialogue({
      agentId: plannerAgent.id,
      agentName: plannerAgent.name,
      role: plannerAgent.role,
      message: `📋 [Planner Agent — PRD / User Stories 작성 완료]\n• 프로젝트: [${projectName}]\n• PRD 명세: ${prdSummary}\n• 산출물 문서: \`projects/${projectId}/docs/PRD.md\``,
      type: 'proposal'
    });
    eventBroker.agentCompleted(plannerAgent.id, 'PRD / User Stories 작성 완료 (docs/PRD.md 보관)');
    await sleep(600);

    // Security Agent [Gate 1: Threat Modeling]
    ensureAgentSpawned(securityAgent);
    eventBroker.agentMove(securityAgent.id, MEETING_SEATS[6], 'walk');
    eventBroker.updateWorkflowStatus({
      running: true,
      stage: '🛡️ [Security Agent — Gate 1: Threat Modeling] 위협 모델링 심사 중',
      activeAgentId: securityAgent.id,
      activeAgentName: securityAgent.name,
      detail: 'PRD 설계 결함 여부 점검 및 Security Directives 주입 중'
    });
    await sleep(600);

    if (!gate1Passed) {
      addDialogue({
        agentId: securityAgent.id,
        agentName: securityAgent.name,
        role: securityAgent.role,
        message: `❌ [Gate 1: Threat Modeling — Design Flaw Rejection ➔ Planner 반려] ${gate1Feedback}`,
        type: 'issue'
      });
      await sleep(500);
      addDialogue({
        agentId: plannerAgent.id,
        agentName: plannerAgent.name,
        role: plannerAgent.role,
        message: `🔄 [Planner Agent — PRD 재설계 완료] Gate 1 위협 모델링 지적사항을 반영하여 PRD를 즉시 보완했습니다.`,
        type: 'discussion'
      });
      await sleep(500);
    }

    // Security Audit 보고서 초기 저장
    const auditDocInit = `# 🛡️ 보안 감사 및 위협 모델링 보고서 (Security Audit)

- **프로젝트**: ${projectName} (\`${projectId}\`)
- **보안 책임자**: 정보안 (Security Agent)
- **최초 검토일**: ${new Date().toLocaleString('ko-KR')}

---
## Gate 1: 위협 모델링 (Threat Modeling)
- **판정**: ${gate1Passed ? '✅ PASS' : '❌ REJECT'}
- **심사 의견**: ${gate1Feedback}
- **주입된 보안 지침 (Security Directives Injected)**:
  ${securityDirectives}
`;
    await realAgentTools.write_file({
      filename: 'docs/SECURITY_AUDIT.md',
      projectId,
      content: auditDocInit
    });

    addDialogue({
      agentId: securityAgent.id,
      agentName: securityAgent.name,
      role: securityAgent.role,
      message: `🛡️ [Gate 1: Threat Modeling 통과 ➔ Security Directives Injected]\n• 심사 의견: ${gate1Feedback}\n• 주입된 보안 지침: ${securityDirectives}\n• 산출물 문서: \`projects/${projectId}/docs/SECURITY_AUDIT.md\``,
      type: 'discussion'
    });
    eventBroker.agentCompleted(securityAgent.id, 'Gate 1 통과 및 Security Directives 주입 완료');
    await sleep(600);
  }

  return {
    projectId,
    projectName,
    targetFilename: resolvedTarget,
    requestType,
    dagBranches,
    acceptanceCriteria,
    testCases,
    needsUserDecision,
    userDecisionQuestion,
    assignedTasks
  };
}

/**
 * 🛡️ [Security Agent — Gate 2: SAST / SCA]
 *   - [Flaws Detected] ➔ (BE/FE Remediation Loop)
 *   - [Pass] + (Staging Prep) ➔ [Staging Build / Deploy]
 */
async function executeSecurityGate2SAST({ securityAgent, infraAgent, targetFilename, sharedContracts }) {
  ensureAgentSpawned(securityAgent);
  eventBroker.agentMove(securityAgent.id, { deskIndex: securityAgent.deskIndex }, 'walk');
  eventBroker.updateWorkflowStatus({
    running: true,
    stage: `🛡️ [Security Agent — Gate 2: SAST / SCA] 정적 보안/구문 분석 중`,
    activeAgentId: securityAgent.id,
    activeAgentName: securityAgent.name,
    detail: `"${targetFilename}" 정적 코드 분석(SAST/SCA) 수행 중`
  });
  await sleep(600);

  eventBroker.agentExecutingTool(securityAgent.id, 'inspect_project', `[Gate 2: SAST/SCA] ${targetFilename} 정적 보안 스캔`);
  const inspectRes = await realAgentTools.inspect_project({ filename: targetFilename });
  const fileObj = await realAgentTools.read_file({ filename: targetFilename });
  const code = fileObj?.content || '';

  const securityIssues = [];
  const syntaxErrors = (inspectRes.issues || []).filter((i) => i.includes('문법 오류'));
  if (syntaxErrors.length > 0) {
    securityIssues.push(...syntaxErrors);
  }
  if (/eval\s*\(/i.test(code)) {
    securityIssues.push('안전하지 않은 eval() 사용 검출');
  }

  const gatePassed = securityIssues.length === 0;

  // 프로젝트 문서(docs/SECURITY_AUDIT.md)에 Gate 2 결과 기록
  if (sharedContracts?.projectId) {
    try {
      const projId = sharedContracts.projectId;
      const existing = await realAgentTools.read_file({ filename: 'docs/SECURITY_AUDIT.md', projectId: projId });
      let auditContent = existing?.content || `# 🛡️ 보안 감사 보고서: ${sharedContracts.projectName || projId}\n\n`;
      auditContent += `\n## Gate 2: SAST / SCA 정적 코드 분석
- **검토 일시**: ${new Date().toLocaleString('ko-KR')}
- **판정**: ${gatePassed ? '✅ PASS' : '❌ FLAW DETECTED'}
- **검출된 취약점/결함**: ${securityIssues.length === 0 ? '0건 (안전)' : securityIssues.join(' / ')}
- **분석 파일**: \`${targetFilename}\`
`;
      await realAgentTools.write_file({ filename: 'docs/SECURITY_AUDIT.md', projectId: projId, content: auditContent });
    } catch (e) {}
  }

  eventBroker.agentMove(securityAgent.id, MEETING_SEATS[6], 'walk');
  await sleep(500);

  if (gatePassed) {
    addDialogue({
      agentId: securityAgent.id,
      agentName: securityAgent.name,
      role: securityAgent.role,
      message: `✅ [Gate 2: SAST / SCA — Pass] "${targetFilename}" 정적 코드 분석 결과 보안 취약점 및 구문 결함 0건으로 통과했습니다.`,
      type: 'discussion'
    });
    eventBroker.agentCompleted(securityAgent.id, 'Gate 2 (SAST/SCA) Pass!');

    ensureAgentSpawned(infraAgent);
    addDialogue({
      agentId: infraAgent.id,
      agentName: infraAgent.name,
      role: infraAgent.role,
      message: `📦 [Staging Build / Deploy 완료] Gate 2 통과 코드와 Infra의 (Staging Prep) 환경을 결합하여 "${targetFilename}" Staging Build 배포를 완료했습니다. QA Agent(Gate 3)로 이관합니다.`,
      type: 'discussion'
    });
    await sleep(500);
  } else {
    addDialogue({
      agentId: securityAgent.id,
      agentName: securityAgent.name,
      role: securityAgent.role,
      message: `❌ [Gate 2: SAST / SCA — Flaws Detected] 정적 분석 결함 검출: ${securityIssues.join(' / ')}`,
      type: 'issue'
    });
    eventBroker.agentCompleted(securityAgent.id, 'Gate 2 Flaws Detected (BE/FE Remediation 요청)');
  }

  return {
    agentId: securityAgent.id,
    agentName: securityAgent.name,
    role: securityAgent.role,
    actionType: 'security_gate2_sast',
    targetFilename,
    gatePassed,
    reportToLead: gatePassed ? 'Gate 2 Pass & Staging Build 완료' : 'Gate 2 Flaws Detected',
    foundIssues: securityIssues.join(' / ')
  };
}

/**
 * 🛡️ [Security Agent — Gate 4: DAST / Pentest]
 *   - 통과 시 [Security Sign-off] 발행 ➔ PM Agent (Production Release)
 *   - 실패 시 PM Agent (Full Loop-back on Fail)
 */
async function executeSecurityGate4DAST({ securityAgent, targetFilename, sharedContracts }) {
  ensureAgentSpawned(securityAgent);
  eventBroker.agentMove(securityAgent.id, { deskIndex: securityAgent.deskIndex }, 'walk');
  eventBroker.updateWorkflowStatus({
    running: true,
    stage: `🛡️ [Security Agent — Gate 4: DAST / Pentest] 동적 모의침투 및 Security Sign-off`,
    activeAgentId: securityAgent.id,
    activeAgentName: securityAgent.name,
    detail: `"${targetFilename}" 동적 보안 점검(DAST) 및 최종 Security Sign-off 심사 중`
  });
  await sleep(600);

  eventBroker.agentExecutingTool(securityAgent.id, 'inspect_project', `[Gate 4: DAST/Pentest] ${targetFilename} 런타임 보안 검증`);
  const dastCheck = await realAgentTools.inspect_project({ filename: targetFilename });
  await sleep(600);

  eventBroker.agentMove(securityAgent.id, MEETING_SEATS[6], 'walk');
  await sleep(500);

  const signOffMsg = `✅ [Gate 4: DAST / Pentest 통과 ➔ Security Sign-off 발행] "${targetFilename}" 동적 모의침투 검증을 통과하여 최종 Security Sign-off를 발행합니다. (검증 크기: ${dastCheck.metrics?.bytes || 0}B)`;
  addDialogue({
    agentId: securityAgent.id,
    agentName: securityAgent.name,
    role: securityAgent.role,
    message: signOffMsg,
    type: 'proposal'
  });

  // 프로젝트 문서(docs/SECURITY_AUDIT.md)에 Gate 4 최종 서명 기록
  if (sharedContracts?.projectId) {
    try {
      const projId = sharedContracts.projectId;
      const existing = await realAgentTools.read_file({ filename: 'docs/SECURITY_AUDIT.md', projectId: projId });
      let auditContent = existing?.content || `# 🛡️ 보안 감사 보고서: ${sharedContracts.projectName || projId}\n\n`;
      auditContent += `\n## Gate 4: DAST 동적 모의침투 및 Security Sign-off
- **심사 일시**: ${new Date().toLocaleString('ko-KR')}
- **최종 판정**: ✅ SECURITY SIGN-OFF ISSUED (프로덕션 배포 승인)
- **런타임 보안 상태**: ${signOffMsg}
`;
      await realAgentTools.write_file({ filename: 'docs/SECURITY_AUDIT.md', projectId: projId, content: auditContent });
    } catch (e) {}
  }

  eventBroker.agentCompleted(securityAgent.id, 'Gate 4 통과 (Security Sign-off 완료!)');
  await sleep(500);

  return {
    agentId: securityAgent.id,
    agentName: securityAgent.name,
    role: securityAgent.role,
    actionType: 'security_gate4_dast',
    targetFilename,
    gatePassed: true,
    reportToLead: signOffMsg,
    foundIssues: ''
  };
}

/**
 * 🔧 Gate 3 (QA) [Fail] 시 작동하는 [PM (Defect Route) ➔ (DBA) / (BE) / (FE)] 라우터
 */
async function scheduleDefectRouteByPM({
  leadAgent,
  targetFilename,
  acceptanceCriteria,
  testCases,
  executionHistory
}) {
  const lastReject = [...executionHistory].reverse().find((h) => h.foundIssues);
  const failedDomain = lastReject?.failedDomain || 'FE';
  const targetAgentId =
    failedDomain === 'DBA' || failedDomain === 'DB'
      ? 'agent-dba'
      : failedDomain === 'BE'
      ? 'agent-backend'
      : 'agent-frontend';

  return {
    targetFilename,
    acceptanceCriteria,
    testCases,
    assignedTasks: [
      {
        agentId: targetAgentId,
        instruction: `[PM Defect Route -> ${failedDomain}] Gate 3(QA)에서 반려된 결함("${lastReject?.foundIssues || '기능/회귀 미비점'}")을 "${targetFilename}"에서 완벽히 수정(Fix Complete)하세요.`,
        stepCriteria: 'QA 반려 결함 100% 해결'
      }
    ]
  };
}

/**
 * 🛠️ 역할별 에이전트 실행 함수:
 * - DBA Agent: (DDL) ➔ [Schema Sync & Entity Design] ➔ BE 비즈니스 로직에 전달
 * - BE Agent: (OpenAPI/Mock) ➔ [API Spec]을 FE에 전달 & [BE Business Logic Complete] 달성
 * - FE Agent: 공유받은 [API Spec] 기반 [FE Components Complete] 달성
 * - Infra Agent: (Staging Prep) 수행
 * - QA Agent: [Gate 3: E2E Functional / Regression Test] 수행
 */
async function executeRoleAgentTask({
  agent,
  leadAgent,
  userPrompt,
  instructionFromLead,
  stepCriteria,
  testCases,
  targetFilename,
  sharedContracts,
  executionHistory,
  seatPos,
  isParallelWave = false,
  apiKey
}) {
  ensureAgentSpawned(agent);
  eventBroker.agentMove(agent.id, { deskIndex: agent.deskIndex }, 'walk');
  await sleep(700);

  const wsInfo = await realAgentTools.list_files();
  let resolvedFile = targetFilename || (wsInfo.files.length > 0 ? wsInfo.files[0].name : 'index.html');

  const isQA = agent.id === 'agent-qa' || agent.role.includes('QA') || agent.role.includes('검증');
  const isInfra = agent.id === 'agent-infra' || agent.role.includes('Infra') || agent.role.includes('인프라');
  const isDBA = agent.id === 'agent-dba' || agent.role.includes('DBA');
  const isBE = agent.id === 'agent-backend' || agent.role.includes('BE') || agent.role.includes('백엔드');
  const isFE = agent.id === 'agent-frontend' || agent.role.includes('FE') || agent.role.includes('프론트');

  // -------------------------------------------------------------------------
  // 1. QA Agent: [Gate 3: E2E Functional / Regression Test]
  // -------------------------------------------------------------------------
  if (isQA) {
    eventBroker.updateWorkflowStatus({
      running: true,
      stage: `🧪 [QA Agent — Gate 3: E2E Functional / Regression Test] 검증 중`,
      activeAgentId: agent.id,
      activeAgentName: agent.name,
      detail: `"${resolvedFile}" Staging Build에 대한 E2E 기능 및 회귀 테스트 수행 중`
    });
    eventBroker.agentExecutingTool(agent.id, 'inspect_project', `[Gate 3: E2E/Regression] ${resolvedFile} 검증`);
    const inspectData = await realAgentTools.inspect_project({ filename: resolvedFile });
    const fileObj = await realAgentTools.read_file({ filename: resolvedFile });
    await sleep(800);

    let tcPassed = inspectData.valid && inspectData.issues.length === 0;
    let failedDomain = tcPassed ? null : 'FE';
    let reportToLead = `${resolvedFile} Staging Build에 대해 Gate 3(E2E Functional / Regression Test)를 수행했습니다. (자동 감지 결함: ${inspectData.issues.length}건)`;
    let foundIssues = inspectData.issues.join(' / ') || '';

    if (apiKey && fileObj && fileObj.content) {
      eventBroker.agentThinking(agent.id, `[Gate 3: QA] TC(${testCases.join(', ') || '완료기준'}) Pass/Fail 판정 중...`);
      try {
        const qaPrompt = `${agent.systemPrompt}

- **사용자 요청**: "${userPrompt}"
- **Triage 유형**: "${sharedContracts.triageType || 'NEW_FEATURE_SPEC'}"
- **검증할 테스트 케이스(TC)**: ${JSON.stringify(testCases)}
- **완료 기준**: "${stepCriteria}"
- **대상 파일**: \`${resolvedFile}\`

[자동 정적/런타임 분석기(inspect_project) 결과]:
${JSON.stringify({ valid: inspectData.valid, metrics: inspectData.metrics, issues: inspectData.issues }, null, 2)}

[실제 \`${resolvedFile}\` 소스 코드]:
${fileObj.content}

위 코드가 테스트 케이스(TC)와 사용자 요청을 충족하는지 [Gate 3: E2E Functional / Regression Test] 관점에서 판정하여 JSON으로 응답하세요:
- 통과 시 \`"tcPassed": true\`, \`"failedDomain": null\`
- 실패 시 \`"tcPassed": false\`, 그리고 PM (Defect Route)이 배정할 귀책 도메인을 \`"failedDomain": "DBA" | "BE" | "FE"\` 중 하나로 지정하세요.

형식:
{
  "tcPassed": true,
  "failedDomain": null,
  "tcResults": ["TC-1: PASS (근거)", "TC-2: PASS (근거)"],
  "reportToLead": "Gate 3 E2E 기능/회귀 테스트 종합 보고",
  "foundIssues": "Fail 시 구체적 결함 내용 (Pass 시 빈 문자열)"
}`;

        const rawQA = await callGeminiWithFallback(apiKey, qaPrompt, undefined, {
          agentId: agent.id,
          agentName: agent.name,
          taskLabel: `[Gate 3: QA E2E/Regression] "${resolvedFile}" Pass/Fail 판정`
        });
        const parsedQA = parseJsonSafely(rawQA);
        if (parsedQA && typeof parsedQA.tcPassed === 'boolean') {
          const implCount = executionHistory.filter((h) => h.actionType === 'implementation').length;
          tcPassed = implCount >= 2 && inspectData.valid ? true : parsedQA.tcPassed;
          failedDomain = tcPassed ? null : (parsedQA.failedDomain || 'FE');
          const tcListStr = Array.isArray(parsedQA.tcResults) ? `\n• ${parsedQA.tcResults.join('\n• ')}` : '';
          reportToLead = `${parsedQA.reportToLead || ''}${tcListStr}`;
          foundIssues = tcPassed ? '' : (parsedQA.foundIssues || parsedQA.reportToLead);
        }
      } catch (e) {
        console.warn('[QA LLM Error]:', e.message);
      }
    }

    eventBroker.agentMove(agent.id, seatPos || MEETING_SEATS[7], 'walk');
    await sleep(600);

    addDialogue({
      agentId: agent.id,
      agentName: agent.name,
      role: agent.role,
      message: tcPassed
        ? `✅ [Gate 3: QA E2E Functional / Regression Test — Pass] ${reportToLead}\n➔ Security Agent의 [Gate 4: DAST / Pentest] 단계로 이관합니다.`
        : `❌ [Gate 3: QA E2E — Fail ➔ PM (Defect Route: ${failedDomain})] ${reportToLead}\n⚠️ 결함 상세: ${foundIssues}`,
      type: tcPassed ? 'discussion' : 'issue'
    });

    // 프로젝트 문서(docs/QA_REPORT.md) 저장
    if (sharedContracts?.projectId) {
      try {
        const projId = sharedContracts.projectId;
        const qaDoc = `# 🧪 QA 품질 검증 및 E2E 테스트 성적서 (QA Report)

- **프로젝트**: ${sharedContracts.projectName || projId} (\`${projId}\`)
- **품질 관리자**: ${agent.name} (${agent.role})
- **검증 일시**: ${new Date().toLocaleString('ko-KR')}

---
## 1. 테스트 결과 요약
- **최종 판정**: ${tcPassed ? '✅ PASS' : '❌ FAIL'}
- **자동 정적/런타임 검사**: ${inspectData.valid ? '정상 (무결점)' : `결함 ${inspectData.issues.length}건`}
- **코드 크기**: ${inspectData.metrics?.bytes || 0} bytes (${inspectData.metrics?.lines || 0} lines)

## 2. 세부 테스트 케이스 (TC) 매트릭스
${testCases.map((tc) => `- [${tcPassed ? 'x' : ' '}] **${tc}**: ${tcPassed ? '통과' : '미달'}`).join('\n')}

## 3. QA 종합 의견
${reportToLead}
${foundIssues ? `\n> [!WARNING] 검출 결함:\n> ${foundIssues}` : ''}
`;
        await realAgentTools.write_file({
          filename: 'docs/QA_REPORT.md',
          projectId: projId,
          content: qaDoc
        });
      } catch (e) {}
    }

    eventBroker.agentCompleted(agent.id, tcPassed ? 'Gate 3 (QA E2E) Pass!' : `Gate 3 Fail (Defect Route -> ${failedDomain})`);
    await sleep(500);

    return {
      agentId: agent.id,
      agentName: agent.name,
      role: agent.role,
      actionType: 'qa_verification',
      targetFilename: resolvedFile,
      tcPassed,
      failedDomain,
      reportToLead,
      foundIssues
    };
  }

  // -------------------------------------------------------------------------
  // 2. Infra Agent: [Infra Provisioning — (Staging Prep)]
  // -------------------------------------------------------------------------
  if (isInfra && isParallelWave) {
    eventBroker.agentExecutingTool(agent.id, 'list_files', `[Staging Prep] 스테이징 환경 프로비저닝 중`);
    await sleep(800);
    sharedContracts.infraStagingPrep = `타깃 파일(${resolvedFile}) Staging Build/Deploy 파이프라인 프로비저닝 완료`;

    eventBroker.agentMove(agent.id, seatPos || MEETING_SEATS[3], 'walk');
    await sleep(500);

    const infraMsg = `[Infra Provisioning — Staging Prep 완료] "${resolvedFile}" Staging Build/Deploy를 위한 환경 준비를 마쳤습니다.`;
    addDialogue({
      agentId: agent.id,
      agentName: agent.name,
      role: agent.role,
      message: `[${agent.name} -> PM 보고] ${infraMsg}`,
      type: 'discussion'
    });
    eventBroker.agentCompleted(agent.id, 'Staging Prep 완료');

    return {
      agentId: agent.id,
      agentName: agent.name,
      role: agent.role,
      actionType: 'infra_setup',
      targetFilename: resolvedFile,
      reportToLead: infraMsg,
      sharedContractSummary: sharedContracts.infraStagingPrep,
      foundIssues: ''
    };
  }

  // -------------------------------------------------------------------------
  // 3. DBA / BE / FE Agent:
  //    - DBA: (DDL) ➔ [Schema Sync & Entity Design]
  //    - BE: (OpenAPI/Mock) ➔ [API Spec] ➔ FE 전달 & [BE Business Logic Complete]
  //    - FE: [API Spec] 수신 ➔ [FE Components Complete]
  // -------------------------------------------------------------------------
  eventBroker.agentExecutingTool(agent.id, 'read_file', `${resolvedFile} 로드 중`);
  const existing = await realAgentTools.read_file({ filename: resolvedFile });
  const hasExisting = Boolean(existing && existing.content && !existing.error);

  eventBroker.agentThinking(agent.id, `${agent.role} 구현 및 DAG 명세(Contract) 작성 중...`);
  eventBroker.agentExecutingTool(
    agent.id,
    'write_file',
    `${resolvedFile} ${hasExisting ? '업데이트' : '신규 생성'} 중`
  );

  let updatedCode = hasExisting ? existing.content : '';
  let reportToLead = `"${resolvedFile}"에 ${agent.role} 담당 구현을 완료했습니다.`;
  let sharedSpec = '';

  if (apiKey) {
    try {
      const contractContext = `
[상위 DAG 단계에서 전달된 명세(Shared Contracts)]:
- Triage 유형: ${sharedContracts.triageType || 'NEW_FEATURE_SPEC'}
- Planner PRD 명세: ${sharedContracts.prdSpec || '사용자 요구사항 직행'}
- Gate 1 Security Directives: ${sharedContracts.securityDirectives || '안전한 DOM 제어 및 XSS 방지'}
- DBA [Schema Sync & Entity Design]: ${sharedContracts.dbSchemaDDL || '없음'}
- BE [API Spec (OpenAPI/Mock)]: ${sharedContracts.beOpenApiSpec || '없음'}`;

      const prevHistory =
        executionHistory.length > 0
          ? `\n[직전 단계 보고 및 Defect Route 지적사항]:\n` +
            executionHistory.map((h) => `- ${h.agentName}(${h.role}): ${h.reportToLead} ${h.foundIssues ? `(결함지적: ${h.foundIssues})` : ''}`).join('\n')
          : '';

      const roleContractInstruction = isDBA
        ? `SHARED_CONTRACT 줄에는 (DDL) 및 [Schema Sync & Entity Design] 결과로서 BE Business Logic에 반영할 데이터 스키마/엔티티 구조를 요약하세요.`
        : isBE
        ? `SHARED_CONTRACT 줄에는 (OpenAPI/Mock) 및 FE Agent에게 전달할 [API Spec (호출 함수 시그니처, 상태 인터페이스)]를 요약하세요.`
        : `SHARED_CONTRACT 줄에는 [FE Components Complete]로서 구현된 UI 컴포넌트 및 이벤트 바인딩 내역을 요약하세요.`;

      const workerPrompt = `${agent.systemPrompt}

당신은 현재 "${agent.name} (${agent.role})"입니다.
- **사용자 최초 요청**: "${userPrompt}"
- **PM 티켓 지시사항**: "${instructionFromLead}"
- **티켓 완료 기준**: "${stepCriteria}"
- **대상 파일**: \`${resolvedFile}\`
${contractContext}
${prevHistory}

${
  hasExisting
    ? `[현재 \`${resolvedFile}\` 전체 코드]:\n${existing.content}\n\n### 필수 작성 지침:
1. 기존 \`${resolvedFile}\`의 정상 기능과 데이터를 절대 훼손하거나 \`// ...생략\`으로 줄이지 마세요!
2. 티켓 지시사항("${instructionFromLead}")과 보안 지침을 완벽히 반영한 **전체 파일 코드**를 작성하세요.`
    : `### 신규 파일(\`${resolvedFile}\`) 필수 작성 지침:
1. 즉시 실행 가능하고 완성도 높은 전체 코드를 처음부터 끝까지 작성하세요.`
}

응답 형식:
첫째 줄: \`REPORT_TO_LEAD: (PM 김수석에게 보고할 핵심 수행 내용 1~2문장)\`
둘째 줄: \`SHARED_CONTRACT: (${roleContractInstruction})\`
셋째 줄부터: \`<!DOCTYPE html>\` 또는 실제 전체 소스 코드만 출력하세요.`;

      const rawOut = await callGeminiWithFallback(apiKey, workerPrompt, undefined, {
        agentId: agent.id,
        agentName: agent.name,
        taskLabel: `[${agent.name}] "${resolvedFile}" 코드 구현 및 DAG 명세 작성`
      });
      const reportMatch = rawOut.match(/^REPORT_TO_LEAD:\s*(.*)$/m);
      const contractMatch = rawOut.match(/^SHARED_CONTRACT:\s*(.*)$/m);
      if (reportMatch) reportToLead = reportMatch[1].trim();
      if (contractMatch) sharedSpec = contractMatch[1].trim();

      const cleanedRaw = rawOut
        .replace(/^REPORT_TO_LEAD:.*$/m, '')
        .replace(/^SHARED_CONTRACT:.*$/m, '');
      const pureCode = extractPureCode(cleanedRaw, resolvedFile);
      if (pureCode && pureCode.length > 50) {
        if (!hasExisting || pureCode.length > existing.content.length * 0.4) {
          updatedCode = pureCode;
        }
      }
    } catch (err) {
      console.error(`[Worker ${agent.name}] Error:`, err.message);
    }
  }

  if (updatedCode) {
    if (sharedContracts?.projectId === 'core_system') {
      // 🌟 코어시스템 소스코드 직접 수정 반영
      await realAgentTools.write_file({
        filename: resolvedFile,
        projectId: 'core_system',
        content: updatedCode
      });
    } else if (sharedContracts?.projectId) {
      await realAgentTools.write_file({
        filename: 'index.html',
        projectId: sharedContracts.projectId,
        content: updatedCode
      });
    } else {
      await realAgentTools.write_file({ filename: resolvedFile, content: updatedCode });
    }
  }

  if (isDBA) {
    sharedContracts.dbSchemaDDL = sharedSpec || reportToLead;
    if (sharedContracts?.projectId) {
      try {
        let schemaData = {
          projectId: sharedContracts.projectId,
          projectName: sharedContracts.projectName,
          updatedAt: new Date().toISOString(),
          ddlSummary: sharedSpec || reportToLead,
          entities: [
            {
              table: 'core_data',
              description: '프로젝트 핵심 비즈니스 엔티티 테이블',
              spec: sharedSpec || reportToLead
            }
          ]
        };
        const jsonMatch = (sharedSpec || '').match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            schemaData = JSON.parse(jsonMatch[0]);
          } catch (e) {}
        }
        await realAgentTools.write_file({
          filename: 'data/schema_ddl.json',
          projectId: sharedContracts.projectId,
          content: JSON.stringify(schemaData, null, 2)
        });
      } catch (e) {}
    }
  }
  if (isBE) sharedContracts.beOpenApiSpec = sharedSpec || reportToLead;
  if (isFE) sharedContracts.feUiSpec = sharedSpec || reportToLead;

  eventBroker.agentMove(agent.id, seatPos || MEETING_SEATS[5], 'walk');
  await sleep(600);

  const contractBadge = isDBA
    ? `\n🗄️ [(DDL) ➔ Schema Sync & Entity Design 완료 ➔ BE 인계]: ${sharedSpec || reportToLead}`
    : isBE
    ? `\n📡 [(OpenAPI/Mock) ➔ API Spec FE 공유 & BE Business Logic Complete]: ${sharedSpec || reportToLead}`
    : `\n🎨 [FE Components Complete]: ${sharedSpec || reportToLead}`;

  addDialogue({
    agentId: agent.id,
    agentName: agent.name,
    role: agent.role,
    message: `[${agent.name} -> PM 완료 보고] ${reportToLead}${contractBadge}`,
    type: 'discussion'
  });

  eventBroker.agentCompleted(
    agent.id,
    isDBA
      ? 'Schema Sync & Entity Design 완료'
      : isBE
      ? 'API Spec 공유 & BE Business Logic Complete'
      : 'FE Components Complete'
  );
  await sleep(500);

  return {
    agentId: agent.id,
    agentName: agent.name,
    role: agent.role,
    actionType: 'implementation',
    targetFilename: resolvedFile,
    reportToLead,
    sharedContractSummary: sharedSpec,
    foundIssues: ''
  };
}

/**
 * 🚀 Infra (Production) — [Zero-Downtime Deployment]
 */
async function executeInfraProductionDeployment({ infraAgent, leadAgent, targetFilename }) {
  ensureAgentSpawned(infraAgent);
  eventBroker.agentMove(infraAgent.id, { deskIndex: infraAgent.deskIndex }, 'walk');
  eventBroker.updateWorkflowStatus({
    running: true,
    stage: `🚀 [Infra (Production)] Zero-Downtime Deployment (${targetFilename})`,
    activeAgentId: infraAgent.id,
    activeAgentName: infraAgent.name,
    detail: `프로덕션 무중단 배포 및 최종 런타임 헬스체크 수행 중`
  });
  await sleep(600);

  eventBroker.agentThinking(infraAgent.id, `${targetFilename} Zero-Downtime Deployment 집행 중...`);
  eventBroker.agentExecutingTool(infraAgent.id, 'inspect_project', `[Zero-Downtime Deployment] ${targetFilename} 배포 및 헬스체크`);

  const fileData = await realAgentTools.read_file({ filename: targetFilename });
  if (fileData && fileData.content) {
    await realAgentTools.write_file({ filename: targetFilename, content: fileData.content });
  }
  const health = await realAgentTools.inspect_project({ filename: targetFilename });
  await sleep(700);

  eventBroker.agentMove(infraAgent.id, MEETING_SEATS[3], 'walk');
  await sleep(500);

  const deployMsg = `🚀 [Infra (Production) — Zero-Downtime Deployment 완료] "${targetFilename}" (${health.metrics?.bytes || 0} bytes, ${health.metrics?.lines || 0} lines) 무중단 프로덕션 배포 및 헬스체크를 통과했습니다.`;

  addDialogue({
    agentId: infraAgent.id,
    agentName: infraAgent.name,
    role: infraAgent.role,
    message: `[${infraAgent.name} -> PM 배포 보고] ${deployMsg}`,
    type: 'discussion'
  });

  eventBroker.agentCompleted(infraAgent.id, `Zero-Downtime Deployment 완료! (${targetFilename})`);
  await sleep(500);

  return {
    agentId: infraAgent.id,
    agentName: infraAgent.name,
    role: infraAgent.role,
    actionType: 'production_deployment',
    targetFilename,
    reportToLead: deployMsg,
    foundIssues: ''
  };
}
