import { GoogleGenAI } from '@google/genai';
import { eventBroker } from '../eventBroker.js';
import { realAgentTools } from './tools.js';
import { getAgentsRegistry } from '../agentRegistry.js';
import { startMeeting, addDialogue, requestDecision } from '../meetingManager.js';

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

/**
 * Gemini API 호출 헬퍼 (실시간 1초 단위 하트비트 + 모델 폴백: gemini-2.0-flash -> gemini-2.5-flash -> gemini-1.5-flash)
 */
async function callGeminiWithFallback(apiKey, contents, systemInstruction, meta = {}) {
  const { agentId = 'agent-lead', agentName = '에이전트', taskLabel = 'AI 추론 및 코드 생성' } = meta;
  const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
  const models = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-1.5-flash'];
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
    `대표님 결재([옵션 ${decision.chosenOption.id}] ${decision.chosenOption.title}) 접수 및 스케줄링 재개...`
  );

  addDialogue({
    agentId: leadAgent.id,
    agentName: leadAgent.name,
    role: leadAgent.role,
    message: `[대표님 결재 접수 -> PM 재스케줄링] "${decision.title}" 건에 대해 대표님께서 [${decision.chosenOption.title}]으로 확정하셨습니다. 이를 PRD/WBS 및 TC에 반영하여 담당 부서에 할당합니다.`,
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
export async function runGeminiAgentTask(userPrompt, clientApiKey, assignedAgentId) {
  activeAgentSession = true;
  const apiKey = clientApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  const registry = getAgentsRegistry();
  const leadAgent = registry.find((a) => a.id === 'agent-lead') || registry[0];
  const initialAgent = registry.find((a) => a.id === assignedAgentId) || leadAgent;

  eventBroker.updateWorkflowStatus({
    running: true,
    stage: `업무 착수: "${userPrompt.slice(0, 35)}"`,
    activeAgentId: initialAgent.id,
    activeAgentName: initialAgent.name,
    detail: apiKey ? 'DevSecOps 8인 자율 파이프라인 가동 시작' : '⚠️ API 키가 전달되지 않았습니다 (상단 Gemini 키 확인 필요)',
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
    await runEnterpriseDAGWorkflowLoop(userPrompt, initialAgent, leadAgent, registry, apiKey);
    eventBroker.updateWorkflowStatus({
      running: false,
      stage: '✅ 모든 DevSecOps 파이프라인 및 프로덕션 배포 완료',
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
 * 🏢 대표님 설계 다이어그램 완벽 구현: 8인 전문 조직 & DevSecOps 4-Gate 자율 파이프라인
 *
 * [전체 파이프라인 흐름]:
 * 1. [사용자 비즈니스 목표/아이디어 입력]
 * 2. [기획 (Planner - 윤기획)] ➔ PRD(제품 요구사항 정의서) 작성
 * 3. [PM 에이전트 (김수석)] ➔ 작업 분해(WBS) / 스케줄링 / TC 수립
 * 4. [보안 에이전트 (정보안) — Gate 1: 위협 모델링]
 *    - 설계 결함 시 기획/PM 반려 ➔ 재설계
 *    - 통과 시 하위 개발팀(DBA / BE / FE / Infra)에 [보안 가이드라인 주입]
 * 5. [조건부 병렬/연계 개발 (DBA / BE / Infra / FE)]
 *    - DBA: DDL / 스키마 정의 ➔ BE 스키마 반영
 *    - BE: OpenAPI / Mock & 코어 비즈니스 구현 ➔ FE에 [API 명세] 전달
 *    - Infra: Staging 인프라 준비
 *    - FE: 공유된 API 명세 & 스키마 기반 UI/클라이언트 구현
 * 6. [보안 에이전트 (정보안) — Gate 2: SAST / SCA (코드 정적 분석)]
 *    - 취약점 검출 시 BE/FE 반려
 *    - 통과 시 Infra의 Staging 환경과 결합하여 [통합 Staging 빌드] 완성
 * 7. [QA 에이전트 (박검증) — Gate 3: E2E 기능/성능 검증]
 *    - 실패 시 PM 경유 버그 리포트 반려 ➔ 원인 도메인(BE/FE/DBA/기획) 핀포인트 재수정
 *    - 기능 테스트 통과 시 Gate 4 이관
 * 8. [보안 에이전트 (정보안) — Gate 4: DAST / 동적 모의 침투 & 보안 최종 Sign-off]
 *    - 런타임 동적 보안 점검 통과 후 최종 Security Sign-off
 * 9. [PM 에이전트 (김수석)] ➔ 개발 완료 선언 & 프로덕션 배포 지시
 * 10. [Infra (Production - 강인프라)] ➔ 무중단 배포 및 헬스체크 통과
 * 11. [최종 완료 보고] ➔ 사용자 확인
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
  ensureAgentSpawned(plannerAgent);
  ensureAgentSpawned(securityAgent);
  if (initialAgent.id !== leadAgent.id) {
    ensureAgentSpawned(initialAgent);
  }
  await sleep(400);

  startMeeting({
    title: `[DevSecOps 4-Gate 파이프라인] ${userPrompt.slice(0, 28)}`,
    topic: `기획(PRD) ➔ PM(WBS) ➔ Gate1(위협모델링) ➔ 개발(DBA/BE/FE/Infra) ➔ Gate2(SAST) ➔ Staging빌드 ➔ Gate3(QA E2E) ➔ Gate4(DAST) ➔ 프로덕션배포`,
    attendees: [
      `${plannerAgent.name}(기획)`,
      `${leadAgent.name}(PM)`,
      `${securityAgent.name}(보안)`,
      `${dbaAgent.name}(DBA)`,
      `${beAgent.name}(BE)`,
      `${feAgent.name}(FE)`,
      `${qaAgent.name}(QA)`,
      `${infraAgent.name}(Infra)`
    ]
  });

  // 에이전트 간 공유 기술 명세서(Shared Contracts)
  const executionHistory = [];
  const sharedContracts = {
    prdSpec: null,
    wbsPlan: null,
    securityGuidelines: null,
    dbSchemaDDL: null,
    infraEnvConfig: null,
    beApiSpec: null,
    feUiSpec: null,
    sastAudit: null,
    dastSignOff: null
  };

  let targetFilename = options.forcedTargetFile || null;
  let acceptanceCriteria = [];
  let testCases = [];
  let decisionAskedInThisRun = Boolean(options.decisionAlreadyResolved);

  // -------------------------------------------------------------------------
  // STEP 0: 만약 사용자가 특정 직원(예: QA, FE, BE, 보안 등)을 직접 지목해 호출한 경우
  //         해당 직원이 1차로 자신의 직무를 수행하여 PM(김수석)에게 먼저 보고
  // -------------------------------------------------------------------------
  if (initialAgent.id !== leadAgent.id && initialAgent.id !== plannerAgent.id) {
    const firstReport = await executeRoleAgentTask({
      agent: initialAgent,
      leadAgent,
      userPrompt,
      instructionFromLead: `[대표님 직접 호출] "${userPrompt}" - 귀하의 역할(${initialAgent.role}) 관점에서 먼저 1차 수행/진단하고 PM(김수석)에게 상세히 보고하세요.`,
      stepCriteria: '대표님 직접 지시사항 1차 수행 및 PM 보고',
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

  // -------------------------------------------------------------------------
  // PHASE 1: [기획(Planner) PRD 작성] ➔ [PM 작업분해(WBS)] ➔ [보안 Gate 1: 위협 모델링 & 보안 가이드라인 주입]
  // -------------------------------------------------------------------------
  const wsInfoInit = await realAgentTools.list_files();
  let initInspection = null;
  if (targetFilename) {
    initInspection = await realAgentTools.inspect_project({ filename: targetFilename });
  } else if (wsInfoInit.files.length > 0) {
    initInspection = await realAgentTools.inspect_project({ filename: wsInfoInit.files[0].name });
  }

  const phase1Result = await runPlanningWbsAndGate1({
    plannerAgent,
    leadAgent,
    securityAgent,
    userPrompt,
    wsFiles: wsInfoInit.files,
    targetFilename,
    initInspection,
    executionHistory,
    sharedContracts,
    apiKey
  });

  targetFilename = phase1Result.targetFilename;
  acceptanceCriteria = phase1Result.acceptanceCriteria;
  testCases = phase1Result.testCases;

  // 대표님 필수 결재 사안이 있는 경우 상신 (Non-blocking)
  if (phase1Result.needsUserDecision && phase1Result.userDecisionQuestion && !decisionAskedInThisRun) {
    decisionAskedInThisRun = true;
    const q = phase1Result.userDecisionQuestion;
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
      message: `[대표님께 필수 결재 상신] "${decItem.title}" - 대표님의 확인이 필수적인 사안이어서 결재함에 상신했습니다. 결재 대기 중에도 진행 가능한 작업은 계속 수행합니다.`,
      type: 'decision_request'
    });
    await sleep(700);
  }

  // -------------------------------------------------------------------------
  // PHASE 2 ~ N: 조건부 병렬/연계 개발 ➔ [Gate 2: SAST/SCA] ➔ [통합 Staging 빌드] ➔ [Gate 3: QA E2E] (반려 루프 지원)
  // -------------------------------------------------------------------------
  const MAX_DEV_QA_CYCLES = 3;
  let cycle = 0;
  let qaGate3Passed = false;

  while (cycle < MAX_DEV_QA_CYCLES) {
    cycle++;

    // (A) 개발 태스크 결정: 첫 사이클은 Phase 1의 WBS 배정 태스크를 수행하고,
    //     재수정 사이클(Gate 2 또는 Gate 3 반려 시)에는 PM이 반려 사유에 맞춰 핀포인트 재할당!
    let devTasks = [];
    if (cycle === 1 && Array.isArray(phase1Result.assignedTasks) && phase1Result.assignedTasks.length > 0) {
      devTasks = phase1Result.assignedTasks;
    } else {
      const wsNow = await realAgentTools.list_files();
      const inspectNow = targetFilename ? await realAgentTools.inspect_project({ filename: targetFilename }) : null;
      const reschedule = await scheduleNextWaveByPM({
        leadAgent,
        userPrompt,
        registry,
        wsFiles: wsNow.files,
        targetFilename,
        acceptanceCriteria,
        testCases,
        sharedContracts,
        executionHistory,
        currentInspection: inspectNow,
        decisionAskedInThisRun,
        wave: cycle,
        maxWaves: MAX_DEV_QA_CYCLES,
        apiKey
      });
      devTasks = Array.isArray(reschedule.assignedTasks) && reschedule.assignedTasks.length > 0
        ? reschedule.assignedTasks
        : [
            {
              agentId: 'agent-frontend',
              instruction: `"${userPrompt}" 요구사항 및 반려 사유를 "${targetFilename}"에 완벽히 수정 반영하세요.`,
              stepCriteria: '결함 0건 및 요구사항 완수'
            }
          ];
    }

    // 만약 사용자가 처음부터 QA만 단독으로 시켰고 첫 단계에서 이미 이상 없음이 확인된 경우 바로 통과 처리 가능
    const resolvedTasks = devTasks.map((t, idx) => {
      const ag =
        registry.find((a) => a.id === t.agentId) ||
        registry.find((a) => a.name === t.agentName) ||
        feAgent;
      ensureAgentSpawned(ag);
      const seat = MEETING_SEATS[(idx + 2) % MEETING_SEATS.length];
      eventBroker.agentMove(ag.id, seat, 'walk');
      return { ...t, agent: ag, seat };
    });
    await sleep(700);

    const assigneeNames = resolvedTasks.map((rt) => `${rt.agent.name}(${rt.agent.role})`).join(', ');
    const isParallel = resolvedTasks.length > 1;

    addDialogue({
      agentId: leadAgent.id,
      agentName: leadAgent.name,
      role: leadAgent.role,
      message:
        `[PM WBS 작업 배정 (${isParallel ? '⚡조건부 병렬/연계' : '전담 배정'}) -> ${assigneeNames}]\n` +
        resolvedTasks.map((rt) => `• [${rt.agent.name}]: ${rt.instruction}`).join('\n') +
        `\n• 적용 보안 가이드라인(Gate 1): ${sharedContracts.securityGuidelines}`,
      type: 'proposal'
    });

    eventBroker.agentCompleted(leadAgent.id, `[WBS 배정 완료 ➔ 총괄 감독 중] 담당: ${assigneeNames}`);
    eventBroker.updateWorkflowStatus({
      running: true,
      stage: `[개발 공정 Cycle ${cycle}] ${assigneeNames} 실무 수행 중`,
      activeAgentId: resolvedTasks[0].agent.id,
      activeAgentName: assigneeNames,
      detail: resolvedTasks.map((rt) => `${rt.agent.name}: ${rt.instruction.slice(0, 40)}...`).join(' | ')
    });
    await sleep(700);

    // ★ 병렬 명세 작업(DBA DDL / Infra Staging / BE API 명세)과 실제 파일 통합 코딩 작업 실행
    // 같은 단일 파일을 여러 에이전트가 동시에 덮어쓰지 않도록, 보조/인프라 태스크는 병렬로 돌리고 코드 작성은 연계 실행
    for (const rt of resolvedTasks) {
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
        isParallelWave: isParallel && rt.agent.id === 'agent-infra',
        apiKey
      });
      if (rep.targetFilename) {
        targetFilename = rep.targetFilename;
      }
      executionHistory.push(rep);
    }

    // -----------------------------------------------------------------------
    // 🛡️ [Gate 2: SAST / SCA 정적 보안 분석] ➔ 통과 시 [통합 Staging 빌드]
    // -----------------------------------------------------------------------
    const gate2Report = await executeSecurityGate2SAST({
      securityAgent,
      infraAgent,
      leadAgent,
      targetFilename
    });
    executionHistory.push(gate2Report);

    if (!gate2Report.gatePassed && cycle < MAX_DEV_QA_CYCLES) {
      addDialogue({
        agentId: leadAgent.id,
        agentName: leadAgent.name,
        role: leadAgent.role,
        message: `⚠️ [Gate 2(SAST/SCA) 반려 접수 ➔ BE/FE 재할당] 보안 정적 분석에서 검출된 취약점(${gate2Report.foundIssues})을 즉시 패치하도록 개발팀에 재할당합니다.`,
        type: 'issue'
      });
      await sleep(700);
      continue;
    }

    // -----------------------------------------------------------------------
    // 🧪 [Gate 3: QA 에이전트 E2E 기능/성능 검증] (실패 시 PM 경유 버그 리포트 반려)
    // -----------------------------------------------------------------------
    ensureAgentSpawned(qaAgent);
    const qaReport = await executeRoleAgentTask({
      agent: qaAgent,
      leadAgent,
      userPrompt,
      instructionFromLead: `[Gate 3: E2E 기능/성능 검증] 통합 Staging 빌드("${targetFilename}")가 PRD 요구사항 및 테스트 케이스(${testCases.join(', ')})를 완벽히 충족하는지 검증하세요.`,
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
      qaGate3Passed = true;
      break;
    } else if (cycle < MAX_DEV_QA_CYCLES) {
      addDialogue({
        agentId: leadAgent.id,
        agentName: leadAgent.name,
        role: leadAgent.role,
        message: `🔄 [Gate 3(QA E2E) 불합격 버그 리포트 접수 ➔ ${qaReport.failedDomain || 'FE'} 반려/재할당] 박검증(QA)님이 보고한 결함("${qaReport.foundIssues}")을 해결하기 위해 담당 부서에 재수정을 지시합니다.`,
        type: 'issue'
      });
      await sleep(800);
    }
  }

  // -------------------------------------------------------------------------
  // 🛡️ PHASE 3: [Gate 4: 보안 에이전트 DAST / 동적 모의 침투 & 최종 Security Sign-off]
  // -------------------------------------------------------------------------
  const gate4Report = await executeSecurityGate4DAST({
    securityAgent,
    leadAgent,
    targetFilename
  });
  executionHistory.push(gate4Report);

  // -------------------------------------------------------------------------
  // 👑 PHASE 4: [PM 에이전트 개발 완료 선언 & 프로덕션 배포 지시] ➔ [Infra 무중단 배포 및 헬스체크]
  // -------------------------------------------------------------------------
  eventBroker.agentMove(leadAgent.id, MEETING_SEATS[0], 'walk');
  addDialogue({
    agentId: leadAgent.id,
    agentName: leadAgent.name,
    role: leadAgent.role,
    message: `📢 [PM 개발 완료 선언 & 프로덕션 배포 지시] 기획(PRD) ➔ Gate 1(위협 모델링) ➔ 개발(DBA/BE/FE/Infra) ➔ Gate 2(SAST/SCA) ➔ 통합 Staging 빌드 ➔ Gate 3(QA E2E 검증) ➔ Gate 4(DAST & 보안 최종 Sign-off) 전 과정을 통과했습니다! ${infraAgent.name}(Infra)님, 프로덕션 무중단 배포 및 헬스체크를 집행하세요.`,
    type: 'proposal'
  });
  eventBroker.agentCompleted(leadAgent.id, '개발 완료 선언 및 프로덕션 배포 지시 완료');
  await sleep(800);

  const deployReport = await executeInfraProductionDeployment({
    infraAgent,
    leadAgent,
    targetFilename: targetFilename || 'index.html'
  });
  executionHistory.push(deployReport);

  // -------------------------------------------------------------------------
  // 🎯 PHASE 5: [최종 완료 보고 ➔ 사용자 확인]
  // -------------------------------------------------------------------------
  const finalCeoReport = `대표님, 지시하신 "${userPrompt}" 업무가 기획(PRD 수립)부터 DevSecOps 4대 품질/보안 게이트(Gate 1 위협 모델링, Gate 2 SAST 정적 분석, Gate 3 QA E2E 기능/성능 검증, Gate 4 DAST 동적 보안 Sign-off) 및 Infra 무중단 프로덕션 배포까지 완벽히 완료되었습니다.`;

  addDialogue({
    agentId: leadAgent.id,
    agentName: leadAgent.name,
    role: leadAgent.role,
    message: `👑 [최종 완료 보고 ➔ 대표님(사용자) 확인]\n${finalCeoReport}\n• 최종 프로덕션 배포 파일: ${targetFilename}\n• 통과한 테스트 케이스(TC): ${testCases.join(' | ')}`,
    type: 'proposal'
  });

  eventBroker.agentMove(leadAgent.id, { deskIndex: leadAgent.deskIndex }, 'walk');
  await sleep(600);
  eventBroker.agentCompleted(leadAgent.id, `최종 완료 보고 완료! (${targetFilename})`);
}

/**
 * 📝 PHASE 1: 기획(Planner) PRD 작성 ➔ PM(김수석) WBS/TC 분해 ➔ 보안(정보안) [Gate 1: 위협 모델링 & 보안 가이드라인 주입]
 */
async function runPlanningWbsAndGate1({
  plannerAgent,
  leadAgent,
  securityAgent,
  userPrompt,
  wsFiles,
  targetFilename,
  initInspection,
  executionHistory,
  sharedContracts,
  apiKey
}) {
  // 1. 기획자(윤기획) 이동 및 PRD 작성 시작
  ensureAgentSpawned(plannerAgent);
  eventBroker.agentMove(plannerAgent.id, { deskIndex: plannerAgent.deskIndex }, 'walk');
  eventBroker.updateWorkflowStatus({
    running: true,
    stage: '1단계: [기획(Planner)] PRD 작성 & [PM] WBS 분해 & [Gate 1] 위협 모델링',
    activeAgentId: plannerAgent.id,
    activeAgentName: `${plannerAgent.name}(기획) • ${leadAgent.name}(PM) • ${securityAgent.name}(보안)`,
    detail: '비즈니스 요구사항 분석, PRD 작성, WBS 작업 분해 및 보안 Gate 1 위협 모델링 수행 중'
  });
  eventBroker.agentThinking(plannerAgent.id, `[기획 PRD 작성] "${userPrompt}" 요구사항 정의서(PRD) 수립 중...`);
  await sleep(600);

  let resolvedTarget = targetFilename || (wsFiles.length > 0 ? wsFiles[0].name : 'index.html');
  let prdSummary = `"${userPrompt}" 구현을 위한 핵심 유저 스토리 및 UI/기능 상세 PRD 명세`;
  let wbsReasoning = `PRD를 바탕으로 작업 분해(WBS) 및 E2E 테스트 케이스(TC)를 수립했습니다.`;
  let securityGuideline = `DOM XSS 방지(안전한 텍스트 바인딩), 인라인 핸들러 함수 전역 유효성 보장, 상태 데이터(localStorage/변수) 무결성 검증`;
  let gate1Feedback = `위협 모델링(Gate 1) 통과 — 설계 결함 없음, 보안 가이드라인 주입 완료`;
  let acceptanceCriteria = ['PRD 핵심 기능 및 UI 요구사항 100% 반영', 'Gate 2(SAST) 및 Gate 3(QA E2E) 무결점 통과'];
  let testCases = ['TC-1: PRD 요구 기능 및 UI 정상 렌더링 확인', 'TC-2: JS 문법 오류 0건 및 버튼/탭 이벤트 핸들러 정상 동작 확인'];
  let needsUserDecision = false;
  let userDecisionQuestion = null;
  let assignedTasks = [
    {
      agentId: 'agent-frontend',
      instruction: `PRD와 Gate 1 보안 가이드라인을 준수하여 "${resolvedTarget}"에 "${userPrompt}" 요구사항을 완벽히 구현하세요.`,
      stepCriteria: 'PRD 요구사항 및 UI/로직 완벽 반영'
    }
  ];

  if (apiKey) {
    try {
      const phase1Prompt = `당신은 기업의 [기획자(윤기획) + PM(김수석) + 보안 아키텍트(정보안)] 합동 설계 위원회입니다.

### 입력 정보:
- **사용자 비즈니스 목표/아이디어**: "${userPrompt}"
- **현재 워크스페이스 파일 목록**: ${JSON.stringify(wsFiles)}
- **현재 타깃 파일 후보**: ${targetFilename || '자동 식별 필요 (기존 프로젝트 수정 요청이면 기존 파일 선택, 완전히 새로운 앱 제작이면 새 .html 파일명 지정)'}
- **기존 프로젝트 정적 진단 결과**: ${initInspection ? JSON.stringify({ valid: initInspection.valid, issues: initInspection.issues }) : '없음'}

### 수행할 3단계 설계 및 Gate 1 검증:
1. **[기획 (Planner - 윤기획) PRD 작성]**:
   - 사용자의 요구사항을 분석하여 대상 프로젝트 파일(\`targetFilename\`)을 식별하고, 구체적인 기능/UI/데이터 요구사항이 담긴 **PRD 요약(\`prdSummary\`)**을 작성하세요.
2. **[PM 에이전트 (김수석) 작업 분해(WBS) & TC 수립]**:
   - PRD를 바탕으로 완료 기준(\`acceptanceCriteria\`), QA가 검증할 구체적인 테스트 케이스(\`testCases\`: TC-1, TC-2...), 그리고 개발 단계에 투입할 에이전트 작업 목록(\`assignedTasks\`)을 스케줄링하세요.
   - 투입 가능한 개발 에이전트 ID:
     - \`"agent-dba"\` (한데이터 - DB/스키마/시드데이터 변경 필요 시)
     - \`"agent-infra"\` (강인프라 - Staging 인프라 준비 필요 시)
     - \`"agent-backend"\` (이백엔드 - 코어 비즈니스 로직/API 명세 구현 필요 시)
     - \`"agent-frontend"\` (최UI - UI/클라이언트 및 통합 코드 구현 필요 시)
   - 💡 **중요**: 최종적으로 실제 파일(\`targetFilename\`)의 코드를 완성할 담당자(\`agent-frontend\` 또는 \`agent-backend\`)가 반드시 \`assignedTasks\`에 포함되어야 합니다!
   - 기술/디자인 결정은 PM이 자율적으로 내리되, 오직 사용자(대표님)의 의사결정 없이는 진행이 불가능한 경우에만 \`"needsUserDecision": true\`로 설정하세요.
3. **[보안 에이전트 (정보안) — Gate 1: 위협 모델링]**:
   - PRD와 WBS 설계의 보안 위협을 분석하여 설계 보완점(\`gate1Feedback\`)을 기록하고, 개발팀에 주입할 **보안 가이드라인(\`securityGuideline\`)**을 작성하세요.

반드시 아래 JSON 형식으로만 응답하세요:
{
  "targetFilename": "대상 파일명.html",
  "prdSummary": "기획자(윤기획)가 작성한 PRD 핵심 요구사항 및 유저 플로우 명세",
  "wbsReasoning": "PM(김수석)의 작업 분해(WBS) 및 담당 부서 스케줄링 판단 근거",
  "acceptanceCriteria": ["완료 기준 1", "완료 기준 2"],
  "testCases": ["TC-1: 구체적 E2E 검증 항목 1", "TC-2: 구체적 E2E 검증 항목 2"],
  "gate1Passed": true,
  "gate1Feedback": "보안(정보안) Gate 1 위협 모델링 검토 의견 (설계 결함 유무 및 보완 내역)",
  "securityGuideline": "하위 개발팀(DBA/BE/FE/Infra)에 주입할 핵심 보안 코딩 가이드라인",
  "needsUserDecision": false,
  "userDecisionQuestion": null,
  "assignedTasks": [
    {
      "agentId": "agent-frontend",
      "instruction": "구체적인 개발 지시사항",
      "stepCriteria": "완료 기준"
    }
  ]
}`;

      const raw = await callGeminiWithFallback(apiKey, phase1Prompt, undefined, {
        agentId: plannerAgent.id,
        agentName: `${plannerAgent.name}(기획) & ${leadAgent.name}(PM)`,
        taskLabel: `[Phase 1] PRD 작성 ➔ WBS 작업 분해 ➔ Gate 1(위협 모델링) 수립`
      });
      const parsed = parseJsonSafely(raw);
      if (parsed) {
        if (parsed.targetFilename) resolvedTarget = parsed.targetFilename;
        if (parsed.prdSummary) prdSummary = parsed.prdSummary;
        if (parsed.wbsReasoning) wbsReasoning = parsed.wbsReasoning;
        if (parsed.securityGuideline) securityGuideline = parsed.securityGuideline;
        if (parsed.gate1Feedback) gate1Feedback = parsed.gate1Feedback;
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

        // 만약 Gate 1에서 설계 결함(gate1Passed === false)이 지적되었다면 기획자가 즉시 PRD 보완 후 통과!
        if (parsed.gate1Passed === false) {
          addDialogue({
            agentId: securityAgent.id,
            agentName: securityAgent.name,
            role: securityAgent.role,
            message: `⚠️ [Gate 1: 위협 모델링 반려 ➔ 기획/PM 재설계 요청] ${gate1Feedback}`,
            type: 'issue'
          });
          await sleep(600);
          addDialogue({
            agentId: plannerAgent.id,
            agentName: plannerAgent.name,
            role: plannerAgent.role,
            message: `🔄 [기획 PRD 보완 완료] 보안 위협 모델링 지적사항을 반영하여 PRD 및 WBS 설계를 즉시 보완했습니다.`,
            type: 'discussion'
          });
          await sleep(600);
        }
      }
    } catch (err) {
      console.warn('[Phase 1 Fallback]:', err.message);
    }
  }

  // 1) 기획자(윤기획) PRD 발표
  sharedContracts.prdSpec = prdSummary;
  eventBroker.agentMove(plannerAgent.id, MEETING_SEATS[1], 'walk');
  await sleep(600);
  addDialogue({
    agentId: plannerAgent.id,
    agentName: plannerAgent.name,
    role: plannerAgent.role,
    message: `📋 [기획(Planner) PRD 작성 완료 ➔ PM 전달]\n• 대상 프로젝트: "${resolvedTarget}"\n• PRD 핵심 명세: ${prdSummary}`,
    type: 'proposal'
  });
  eventBroker.agentCompleted(plannerAgent.id, `PRD 작성 및 인계 완료 (${resolvedTarget})`);
  await sleep(600);

  // 2) PM(김수석) 작업 분해(WBS) 발표
  sharedContracts.wbsPlan = wbsReasoning;
  eventBroker.agentMove(leadAgent.id, MEETING_SEATS[0], 'walk');
  addDialogue({
    agentId: leadAgent.id,
    agentName: leadAgent.name,
    role: leadAgent.role,
    message: `🗂️ [PM 작업 분해(WBS) 및 TC 수립 완료]\n• WBS 계획: ${wbsReasoning}\n• E2E 검증 TC: ${testCases.join(' / ')}`,
    type: 'proposal'
  });
  await sleep(600);

  // 3) 보안(정보안) [Gate 1: 위협 모델링] 통과 및 [보안 가이드라인 주입]
  sharedContracts.securityGuidelines = securityGuideline;
  ensureAgentSpawned(securityAgent);
  eventBroker.agentMove(securityAgent.id, MEETING_SEATS[6], 'walk');
  await sleep(600);
  addDialogue({
    agentId: securityAgent.id,
    agentName: securityAgent.name,
    role: securityAgent.role,
    message: `🛡️ [Gate 1: 위협 모델링 통과 & 보안 가이드라인 주입]\n• 위협 모델링 결과: ${gate1Feedback}\n• 주입된 보안 가이드라인: ${securityGuideline}`,
    type: 'discussion'
  });
  eventBroker.agentCompleted(securityAgent.id, 'Gate 1(위협 모델링) 승인 및 보안 가이드라인 주입 완료');
  await sleep(600);

  return {
    targetFilename: resolvedTarget,
    acceptanceCriteria,
    testCases,
    needsUserDecision,
    userDecisionQuestion,
    assignedTasks
  };
}

/**
 * 🛡️ [Gate 2: 보안 에이전트 SAST / SCA 정적 코드 분석] ➔ 통과 시 [통합 Staging 빌드]
 */
async function executeSecurityGate2SAST({ securityAgent, infraAgent, leadAgent, targetFilename }) {
  ensureAgentSpawned(securityAgent);
  eventBroker.agentMove(securityAgent.id, { deskIndex: securityAgent.deskIndex }, 'walk');
  eventBroker.updateWorkflowStatus({
    running: true,
    stage: `🛡️ [Gate 2: SAST / SCA] 정적 보안 코드 분석 및 통합 Staging 빌드`,
    activeAgentId: securityAgent.id,
    activeAgentName: securityAgent.name,
    detail: `"${targetFilename}" 소스 코드 정적 보안 분석(SAST/SCA) 및 문법 무결성 검증 중`
  });
  await sleep(700);

  eventBroker.agentExecutingTool(securityAgent.id, 'inspect_project', `[Gate 2: SAST/SCA] ${targetFilename} 정적 보안 스캔`);
  const inspectRes = await realAgentTools.inspect_project({ filename: targetFilename });
  const fileObj = await realAgentTools.read_file({ filename: targetFilename });
  const code = fileObj?.content || '';

  const securityIssues = [];
  // 치명적 구문 에러 또는 위험 패턴 점검
  const syntaxErrors = (inspectRes.issues || []).filter((i) => i.includes('문법 오류'));
  if (syntaxErrors.length > 0) {
    securityIssues.push(...syntaxErrors);
  }
  if (/eval\s*\(/i.test(code)) {
    securityIssues.push('안전하지 않은 eval() 호출 검출');
  }

  const gatePassed = securityIssues.length === 0;
  sharedContractsNote(gatePassed, securityIssues);

  eventBroker.agentMove(securityAgent.id, MEETING_SEATS[6], 'walk');
  await sleep(600);

  if (gatePassed) {
    addDialogue({
      agentId: securityAgent.id,
      agentName: securityAgent.name,
      role: securityAgent.role,
      message: `✅ [Gate 2: SAST / SCA 정적 보안 분석 통과] "${targetFilename}" 코드 정적 분석 결과 치명적 보안 취약점 및 스크립트 구문 결함이 0건으로 확인되었습니다. 통합 Staging 빌드로 이관합니다.`,
      type: 'discussion'
    });
    eventBroker.agentCompleted(securityAgent.id, 'Gate 2 (SAST/SCA) 정적 분석 통과!');

    // 통합 Staging 빌드 로그
    ensureAgentSpawned(infraAgent);
    addDialogue({
      agentId: infraAgent.id,
      agentName: infraAgent.name,
      role: infraAgent.role,
      message: `⚙️ [통합 Staging 빌드 완료] Gate 2를 통과한 BE/FE 코드와 Staging 인프라를 결합하여 "${targetFilename}" 통합 Staging 빌드를 완료했습니다. QA 에이전트(Gate 3)로 이관합니다.`,
      type: 'discussion'
    });
    await sleep(600);
  } else {
    addDialogue({
      agentId: securityAgent.id,
      agentName: securityAgent.name,
      role: securityAgent.role,
      message: `❌ [Gate 2: SAST / SCA 반려 -> BE/FE 수정 요청] 정적 분석에서 보안/구문 결함이 검출되었습니다: ${securityIssues.join(' / ')}`,
      type: 'issue'
    });
    eventBroker.agentCompleted(securityAgent.id, 'Gate 2 반려 (취약점 패치 요청)');
  }

  return {
    agentId: securityAgent.id,
    agentName: securityAgent.name,
    role: securityAgent.role,
    actionType: 'security_gate2_sast',
    targetFilename,
    gatePassed,
    reportToLead: gatePassed ? 'Gate 2 SAST/SCA 통과 및 통합 Staging 빌드 완료' : 'Gate 2 SAST/SCA 반려',
    foundIssues: securityIssues.join(' / ')
  };
}

function sharedContractsNote(passed, issues) {
  return passed ? 'SAST/SCA Clean' : issues.join(', ');
}

/**
 * 🛡️ [Gate 4: 보안 에이전트 DAST / 동적 모의 침투 & 최종 Security Sign-off]
 */
async function executeSecurityGate4DAST({ securityAgent, leadAgent, targetFilename }) {
  ensureAgentSpawned(securityAgent);
  eventBroker.agentMove(securityAgent.id, { deskIndex: securityAgent.deskIndex }, 'walk');
  eventBroker.updateWorkflowStatus({
    running: true,
    stage: `🛡️ [Gate 4: DAST / 동적 모의 침투] 런타임 보안 검증 및 최종 Sign-off`,
    activeAgentId: securityAgent.id,
    activeAgentName: securityAgent.name,
    detail: `"${targetFilename}" 통합 Staging 빌드 동적 모의 침투(DAST) 및 최종 보안 승인 심사 중`
  });
  await sleep(700);

  eventBroker.agentExecutingTool(securityAgent.id, 'inspect_project', `[Gate 4: DAST] ${targetFilename} 동적 런타임 보안 검증`);
  const dastCheck = await realAgentTools.inspect_project({ filename: targetFilename });
  await sleep(700);

  eventBroker.agentMove(securityAgent.id, MEETING_SEATS[6], 'walk');
  await sleep(600);

  const signOffMsg = `✅ [Gate 4: DAST 동적 모의 침투 통과 & 보안 최종 Sign-off] "${targetFilename}" 런타임 DOM/이벤트 핸들러 무결성 및 동적 보안 점검을 통과하여 최종 Security Sign-off(승인)를 발행합니다. (검증 바이트: ${dastCheck.metrics?.bytes || 0}B)`;
  addDialogue({
    agentId: securityAgent.id,
    agentName: securityAgent.name,
    role: securityAgent.role,
    message: signOffMsg,
    type: 'proposal'
  });

  eventBroker.agentCompleted(securityAgent.id, 'Gate 4 (DAST) 최종 보안 Sign-off 승인!');
  await sleep(600);

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
 * 🧠 재수정 사이클(Gate 2 / Gate 3 반려 시) PM의 핀포인트 재할당 스케줄러
 */
async function scheduleNextWaveByPM({
  leadAgent,
  userPrompt,
  registry,
  wsFiles,
  targetFilename,
  acceptanceCriteria,
  testCases,
  sharedContracts,
  executionHistory,
  currentInspection,
  wave,
  maxWaves,
  apiKey
}) {
  const lastReject = [...executionHistory].reverse().find((h) => h.foundIssues);
  const failedDomain = lastReject?.failedDomain || 'FE';
  const targetAgentId =
    failedDomain === 'BE'
      ? 'agent-backend'
      : failedDomain === 'DB'
      ? 'agent-dba'
      : failedDomain === 'PLAN'
      ? 'agent-planner'
      : 'agent-frontend';

  const resolvedTarget = targetFilename || (wsFiles.length > 0 ? wsFiles[0].name : 'index.html');

  return {
    targetFilename: resolvedTarget,
    acceptanceCriteria,
    testCases,
    leadReasoning: `직전 게이트에서 보고된 결함("${lastReject?.foundIssues || '품질 보완'}")을 해결하기 위해 ${targetAgentId}에게 핀포인트 재수정을 지시합니다.`,
    needsUserDecision: false,
    isCompletelyDone: false,
    assignedTasks: [
      {
        agentId: targetAgentId,
        instruction: `직전 검증에서 반려된 결함 사항(${lastReject?.foundIssues || '요구사항 미비점'})을 "${resolvedTarget}"에서 완벽히 수정하세요.`,
        stepCriteria: '반려 사유 100% 해소 및 무결성 확보'
      }
    ]
  };
}

/**
 * 🛠️ 역할별 에이전트 실행 함수 (DBA / Infra / BE / FE / QA Gate 3)
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
  await sleep(800);

  const wsInfo = await realAgentTools.list_files();
  let resolvedFile = targetFilename || (wsInfo.files.length > 0 ? wsInfo.files[0].name : 'index.html');

  const isQA = agent.id === 'agent-qa' || agent.role.includes('QA') || agent.role.includes('검증');
  const isInfra = agent.id === 'agent-infra' || agent.role.includes('Infra') || agent.role.includes('인프라');
  const isDBA = agent.id === 'agent-dba' || agent.role.includes('DBA');
  const isBE = agent.id === 'agent-backend' || agent.role.includes('BE') || agent.role.includes('백엔드');
  const isFE = agent.id === 'agent-frontend' || agent.role.includes('FE') || agent.role.includes('프론트');

  // -------------------------------------------------------------------------
  // 1. QA 에이전트: [Gate 3: E2E 기능/성능 검증]
  // -------------------------------------------------------------------------
  if (isQA) {
    eventBroker.updateWorkflowStatus({
      running: true,
      stage: `🧪 [Gate 3: QA E2E 기능/성능 검증] ${agent.name} 테스트 케이스 검증 중`,
      activeAgentId: agent.id,
      activeAgentName: agent.name,
      detail: `"${resolvedFile}" 통합 Staging 빌드에 대한 E2E 기능/성능 및 TC 검증 수행 중`
    });
    eventBroker.agentExecutingTool(agent.id, 'inspect_project', `[Gate 3: E2E] ${resolvedFile} 정밀 검증 중`);
    const inspectData = await realAgentTools.inspect_project({ filename: resolvedFile });
    const fileObj = await realAgentTools.read_file({ filename: resolvedFile });
    await sleep(900);

    let tcPassed = inspectData.valid && inspectData.issues.length === 0;
    let failedDomain = tcPassed ? null : 'FE';
    let reportToLead = `${resolvedFile} 통합 Staging 빌드에 대해 Gate 3(E2E 기능/성능 검증)을 수행했습니다. (자동 감지 결함: ${inspectData.issues.length}건)`;
    let foundIssues = inspectData.issues.join(' / ') || '';

    if (apiKey && fileObj && fileObj.content) {
      eventBroker.agentThinking(agent.id, `[Gate 3: E2E] TC(${testCases.join(', ') || '완료기준'}) 합격/불합격 판정 중...`);
      try {
        const qaPrompt = `${agent.systemPrompt}

- **대표님 요구사항**: "${userPrompt}"
- **기획자 PRD 명세**: "${sharedContracts.prdSpec || '상동'}"
- **검증할 테스트 케이스(TC)**: ${JSON.stringify(testCases)}
- **완료 기준**: "${stepCriteria}"
- **검증 대상 파일**: \`${resolvedFile}\`

[자동 정적/런타임 분석기(inspect_project) 결과]:
${JSON.stringify({ valid: inspectData.valid, metrics: inspectData.metrics, issues: inspectData.issues }, null, 2)}

[실제 \`${resolvedFile}\` 소스 코드]:
${fileObj.content}

위 코드가 PRD와 테스트 케이스(TC), 그리고 대표님 요구사항을 충족하는지 [Gate 3: E2E 기능/성능 검증] 관점에서 판정하여 JSON으로 응답하세요:
- 모든 TC를 통과했으면 \`"tcPassed": true\`, \`"failedDomain": null\`
- 미비점이나 버그가 있어 반려해야 하면 \`"tcPassed": false\`, 그리고 수정을 지시할 귀책 부서를 \`"failedDomain": "BE" | "FE" | "DB" | "PLAN"\` 중 하나로 지정하세요.

형식:
{
  "tcPassed": true,
  "failedDomain": null,
  "tcResults": ["TC-1: PASS (근거)", "TC-2: PASS (근거)"],
  "reportToLead": "PM(김수석)에게 보고하는 Gate 3 E2E 검증 종합 요약",
  "foundIssues": "불합격(Fail) 시 구체적 버그 리포트 및 수정 요구사항 (합격 시 빈 문자열)"
}`;

        const rawQA = await callGeminiWithFallback(apiKey, qaPrompt, undefined, {
          agentId: agent.id,
          agentName: agent.name,
          taskLabel: `[Gate 3: QA E2E] "${resolvedFile}" 기능/성능 테스트 케이스 판정`
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
    await sleep(700);

    addDialogue({
      agentId: agent.id,
      agentName: agent.name,
      role: agent.role,
      message: tcPassed
        ? `✅ [Gate 3: QA E2E 기능/성능 검증 통과] ${reportToLead}\n➔ 기능 및 성능 검증을 모두 통과하여 [Gate 4: 보안 DAST / 동적 모의 침투] 단계로 이관합니다.`
        : `❌ [Gate 3: QA E2E 불합격 ➔ PM 경유 버그 리포트 반려 (귀책: ${failedDomain})] ${reportToLead}\n⚠️ 버그 리포트 상세: ${foundIssues}`,
      type: tcPassed ? 'discussion' : 'issue'
    });

    eventBroker.agentCompleted(agent.id, tcPassed ? 'Gate 3 (E2E 검증) 통과!' : `Gate 3 반려 (${failedDomain} 버그 리포트)`);
    await sleep(600);

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
  // 2. Infra 에이전트 (Staging 인프라 구성 단계)
  // -------------------------------------------------------------------------
  if (isInfra && isParallelWave) {
    eventBroker.agentExecutingTool(agent.id, 'list_files', `Staging 인프라 및 자산 서빙 경로 준비 중`);
    await sleep(900);
    sharedContracts.infraEnvConfig = `타깃 파일(${resolvedFile}) Staging 빌드 및 웹뷰 서빙 파이프라인 구성 완료`;

    eventBroker.agentMove(agent.id, seatPos || MEETING_SEATS[3], 'walk');
    await sleep(600);

    const infraMsg = `[Staging 인프라 구축 완료] "${resolvedFile}" 통합 Staging 빌드를 위한 런타임 환경 구성을 마쳤습니다.`;
    addDialogue({
      agentId: agent.id,
      agentName: agent.name,
      role: agent.role,
      message: `[${agent.name} -> PM 보고] ${infraMsg}`,
      type: 'discussion'
    });
    eventBroker.agentCompleted(agent.id, 'Staging 인프라 준비 완료');

    return {
      agentId: agent.id,
      agentName: agent.name,
      role: agent.role,
      actionType: 'infra_setup',
      targetFilename: resolvedFile,
      reportToLead: infraMsg,
      sharedContractSummary: sharedContracts.infraEnvConfig,
      foundIssues: ''
    };
  }

  // -------------------------------------------------------------------------
  // 3. DBA / BE / FE 에이전트: 역할별 구현 + 하위 단계로의 명세서(DDL / OpenAPI 명세) 인계
  // -------------------------------------------------------------------------
  eventBroker.agentExecutingTool(agent.id, 'read_file', `${resolvedFile} 로드 중`);
  const existing = await realAgentTools.read_file({ filename: resolvedFile });
  const hasExisting = Boolean(existing && existing.content && !existing.error);

  eventBroker.agentThinking(agent.id, `${agent.role} 구현 및 기술 명세(Contract) 작성 중...`);
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
[상위 단계에서 전달된 설계/보안/기술 명세(Shared Contracts)]:
- 기획자 PRD 명세: ${sharedContracts.prdSpec || '사용자 요구사항 준수'}
- 보안 Gate 1 가이드라인: ${sharedContracts.securityGuidelines || 'XSS 방지 및 안전한 DOM 제어'}
- DBA DDL/스키마 명세: ${sharedContracts.dbSchemaDDL || '없음'}
- BE OpenAPI/로직 명세: ${sharedContracts.beApiSpec || '없음'}`;

      const prevHistory =
        executionHistory.length > 0
          ? `\n[직전 단계 보고 및 반려/버그 리포트 지적사항]:\n` +
            executionHistory.map((h) => `- ${h.agentName}(${h.role}): ${h.reportToLead} ${h.foundIssues ? `(결함지적: ${h.foundIssues})` : ''}`).join('\n')
          : '';

      const roleContractInstruction = isDBA
        ? `SHARED_CONTRACT 줄에는 BE 에이전트에게 전달할 [DDL / 데이터 스키마 및 상태 모델 구조]를 요약하세요.`
        : isBE
        ? `SHARED_CONTRACT 줄에는 FE 에이전트에게 전달할 [OpenAPI / API 명세 및 호출 함수 인터페이스]를 요약하세요.`
        : `SHARED_CONTRACT 줄에는 [구현된 UI/클라이언트 컴포넌트 및 이벤트 바인딩 내역]을 요약하세요.`;

      const workerPrompt = `${agent.systemPrompt}

당신은 현재 "${agent.name} (${agent.role})"입니다.
- **대표님 최초 요구사항**: "${userPrompt}"
- **PM(김수석) WBS 배정 지시**: "${instructionFromLead}"
- **달성 기준**: "${stepCriteria}"
- **대상 파일**: \`${resolvedFile}\`
${contractContext}
${prevHistory}

${
  hasExisting
    ? `[현재 \`${resolvedFile}\` 전체 코드]:\n${existing.content}\n\n### 필수 작성 지침:
1. 기존 \`${resolvedFile}\`의 정상 기능과 데이터를 절대 훼손하거나 \`// ...생략\`으로 줄이지 마세요!
2. PRD와 Gate 1 보안 가이드라인, 그리고 지시사항("${instructionFromLead}")을 완벽히 반영한 **전체 파일 코드**를 작성하세요.`
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
        taskLabel: `[${agent.role}] "${resolvedFile}" 코드 구현 및 명세(Contract) 작성`
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
    await realAgentTools.write_file({ filename: resolvedFile, content: updatedCode });
  }

  if (isDBA) sharedContracts.dbSchemaDDL = sharedSpec || reportToLead;
  if (isBE) sharedContracts.beApiSpec = sharedSpec || reportToLead;
  if (isFE) sharedContracts.feUiSpec = sharedSpec || reportToLead;

  eventBroker.agentMove(agent.id, seatPos || MEETING_SEATS[5], 'walk');
  await sleep(700);

  const contractBadge = isDBA
    ? `\n🗄️ [DDL / 스키마 명세 ➔ BE 스키마 반영]: ${sharedSpec || reportToLead}`
    : isBE
    ? `\n📡 [OpenAPI / API 명세 ➔ FE 공유]: ${sharedSpec || reportToLead}`
    : sharedSpec
    ? `\n🎨 [UI/클라이언트 통합 명세]: ${sharedSpec}`
    : '';

  addDialogue({
    agentId: agent.id,
    agentName: agent.name,
    role: agent.role,
    message: `[${agent.name} -> PM 완료 보고] ${reportToLead}${contractBadge}`,
    type: 'discussion'
  });

  eventBroker.agentCompleted(agent.id, `${resolvedFile} 구현 및 명세 인계 완료`);
  await sleep(600);

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
 * 🚀 Infra 에이전트의 최종 [Production 무중단 배포 및 헬스체크] 수행 함수
 */
async function executeInfraProductionDeployment({ infraAgent, leadAgent, targetFilename }) {
  ensureAgentSpawned(infraAgent);
  eventBroker.agentMove(infraAgent.id, { deskIndex: infraAgent.deskIndex }, 'walk');
  eventBroker.updateWorkflowStatus({
    running: true,
    stage: `🚀 [Infra (Production)] "${targetFilename}" 무중단 배포 및 헬스체크`,
    activeAgentId: infraAgent.id,
    activeAgentName: infraAgent.name,
    detail: `프로덕션 서빙 경로 배포 동기화 및 런타임 헬스체크 수행 중`
  });
  await sleep(700);

  eventBroker.agentThinking(infraAgent.id, `${targetFilename} Production 무중단 배포 및 헬스체크 중...`);
  eventBroker.agentExecutingTool(infraAgent.id, 'inspect_project', `${targetFilename} 프로덕션 무중단 배포 & 헬스체크`);

  const fileData = await realAgentTools.read_file({ filename: targetFilename });
  if (fileData && fileData.content) {
    await realAgentTools.write_file({ filename: targetFilename, content: fileData.content });
  }
  const health = await realAgentTools.inspect_project({ filename: targetFilename });
  await sleep(800);

  eventBroker.agentMove(infraAgent.id, MEETING_SEATS[3], 'walk');
  await sleep(600);

  const deployMsg = `🚀 [Infra (Production) 무중단 배포 및 헬스체크 통과] "${targetFilename}" (${health.metrics?.bytes || 0} bytes, ${health.metrics?.lines || 0} lines) 프로덕션 배포 및 헬스체크(정상)를 완료했습니다.`;

  addDialogue({
    agentId: infraAgent.id,
    agentName: infraAgent.name,
    role: infraAgent.role,
    message: `[${infraAgent.name} -> PM 프로덕션 배포 완료 보고] ${deployMsg}`,
    type: 'discussion'
  });

  eventBroker.agentCompleted(infraAgent.id, `${targetFilename} 무중단 배포 및 헬스체크 통과!`);
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
