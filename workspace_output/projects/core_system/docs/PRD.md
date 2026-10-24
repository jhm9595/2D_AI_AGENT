# 📋 제품 기획서 (PRD): 코어시스템 (2D_AI_AGENT)

- **프로젝트 명칭**: 코어시스템 (2D AI 에이전트 자율 오피스 플랫폼)
- **식별자**: `core_system`
- **유형**: 시스템 코어 소스코드 (자체 진화 및 메타 유지보수)
- **책임자**: 윤기획 (Planner Agent)

---
## 1. 개요 및 목적
본 프로젝트는 2D 픽셀 스타일 가상 오피스에서 8인의 전문 AI 에이전트(PM, 기획, 보안, DBA, BE, FE, Infra, QA)가 자율적으로 협업하고 시스템 자체를 개선·진화시키는 메인 플랫폼입니다.

## 2. 시스템 아키텍처 모듈
- **Frontend (`frontend/src/`)**:
  - `OfficeCanvas.ts`: HTML5 Canvas 기반 2D 픽셀 오피스 맵 & 8개 워크스테이션
  - `ExecutiveMeetingBoard.tsx`: 경영진 회의 브리핑 및 대표자 의사결정(Non-blocking HITL)
  - `App.tsx`: 메인 대시보드 및 프로젝트별 산출물 보관함(Project Artifacts Hub)
- **Backend (`backend/`)**:
  - `geminiAgent.js`: PM Router, 조건부 DAG 파이프라인, 4대 보안/QA 게이트웨이
  - `projectManager.js`: 코어시스템 및 개별 프로젝트 폴더/문서 관리
  - `eventBroker.js`: 1초 단위 실시간 하트비트 텔레메트리 & 웹소켓 브로드캐스팅

## 3. 핵심 안전 및 가드레일 수칙
1. 보호 대상 파일(`.git/`, `.env`, `node_modules/`)은 어떠한 경우에도 수정/삭제가 원천 차단됩니다.
2. 시스템 코드 수정 후 QA 박검증의 `npm run build`(TypeScript 컴파일 검증)를 통과해야만 실제 반영됩니다.
3. 빌드 실패 시 이전 정상 상태로 즉각 롤백(Rollback)합니다.
