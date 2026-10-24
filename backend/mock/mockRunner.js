import { eventBroker } from '../eventBroker.js';

let activeSimulation = null;
let shouldStop = false;

export function isMockRunning() {
  return activeSimulation !== null;
}

export function stopMockSimulation() {
  shouldStop = true;
  activeSimulation = null;
  console.log('[MockRunner] Simulation requested to stop.');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runMockSimulation(scenario = 'standard') {
  if (activeSimulation) {
    console.log('[MockRunner] Simulation already running.');
    return;
  }
  shouldStop = false;
  activeSimulation = scenario;

  console.log(`[MockRunner] Starting simulation scenario: ${scenario}`);

  try {
    while (!shouldStop) {
      // Step 1: 앨리스 (소프트웨어 아키텍트)
      const agent1 = {
        id: 'agent-1',
        name: '앨리스',
        role: '수석 아키텍트',
        deskIndex: 0,
        avatarColor: '#3b82f6',
        status: 'spawn'
      };
      eventBroker.agentSpawned(agent1);
      await sleep(1200);
      if (shouldStop) break;

      // 앨리스 워크스테이션 1로 이동
      eventBroker.agentMove('agent-1', { deskIndex: 0 }, 'walk');
      await sleep(1800);
      if (shouldStop) break;

      // 요구사항 분석 중
      eventBroker.agentThinking('agent-1', '사용자 요구사항 및 대용량 파이프라인 설계 분석 중...');
      await sleep(2500);
      if (shouldStop) break;

      // 코드 검색 툴 실행
      eventBroker.agentExecutingTool('agent-1', 'search_codebase', '기존 데이터 모델 검색 (src/models/*.ts)');
      await sleep(2000);
      if (shouldStop) break;

      // 설계서 작성
      eventBroker.agentExecutingTool('agent-1', 'write_file', '아키텍처_설계서_v2.md 파일 작성');
      await sleep(2400);
      if (shouldStop) break;

      // Step 2: 밥 (백엔드 엔지니어) 스폰
      const agent2 = {
        id: 'agent-2',
        name: '밥',
        role: '백엔드 개발자',
        deskIndex: 1,
        avatarColor: '#10b981',
        status: 'spawn'
      };
      eventBroker.agentSpawned(agent2);
      await sleep(1000);
      if (shouldStop) break;

      eventBroker.agentMove('agent-2', { deskIndex: 1 }, 'walk');
      await sleep(1800);
      if (shouldStop) break;

      eventBroker.agentThinking('agent-2', '설계서 검토 후 Redis 분산 캐시 모듈 개발 시작');
      await sleep(2000);
      if (shouldStop) break;

      eventBroker.agentExecutingTool('agent-2', 'write_file', 'src/services/cacheBroker.ts 작성 중');
      await sleep(2500);
      if (shouldStop) break;

      // Step 3: 찰리 (QA 및 보안 전문가)
      const agent3 = {
        id: 'agent-3',
        name: '찰리',
        role: 'QA / 보안 엔지니어',
        deskIndex: 2,
        avatarColor: '#f59e0b',
        status: 'spawn'
      };
      eventBroker.agentSpawned(agent3);
      await sleep(1200);
      if (shouldStop) break;

      eventBroker.agentMove('agent-3', { deskIndex: 2 }, 'walk');
      await sleep(1800);
      if (shouldStop) break;

      eventBroker.agentThinking('agent-3', '단위 테스트 및 보안 취약점 점검 준비 중');
      await sleep(2000);
      if (shouldStop) break;

      eventBroker.agentExecutingTool('agent-3', 'run_bash', 'pytest --cov=src -v (테스트 실행)');
      await sleep(2800);
      if (shouldStop) break;

      // 앨리스 커피 마시러 이동
      eventBroker.agentCompleted('agent-1', '아키텍처 설계 완료 및 팀 승인');
      eventBroker.agentMove('agent-1', { station: 'coffee' }, 'walk');
      await sleep(1500);
      if (shouldStop) break;

      // 찰리 검증 완료
      eventBroker.agentCompleted('agent-3', '모든 42개 단위 및 보안 테스트 통과!');
      await sleep(1500);
      if (shouldStop) break;

      // 밥 정수기로 이동
      eventBroker.agentCompleted('agent-2', '캐시 모듈 스테이징 배포 완료');
      eventBroker.agentMove('agent-2', { station: 'water_cooler' }, 'walk');
      await sleep(2000);
      if (shouldStop) break;

      // 찰리 퇴근
      eventBroker.agentMove('agent-3', { station: 'door' }, 'walk');
      await sleep(2000);
      if (shouldStop) break;

      eventBroker.agentTerminated('agent-3', '오늘 업무를 마치고 퇴근합니다.');
      await sleep(1500);
      if (shouldStop) break;

      // 반복 대기
      await sleep(3500);
    }
  } catch (err) {
    console.error('[MockRunner] Error during simulation:', err);
  } finally {
    activeSimulation = null;
    console.log('[MockRunner] Simulation loop finished.');
  }
}
