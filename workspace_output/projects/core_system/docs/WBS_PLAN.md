# 🗂️ WBS 작업 분해 및 유지보수 계획서: 코어시스템

- **총괄 PM**: 김수석 (PM / Technical Lead)
- **대상**: 2D_AI_AGENT 코어 플랫폼 자체 소스코드
- **관리 모드**: Self-Evolution & Meta-Maintenance

---
## 1. DAG 파이프라인 흐름
```text
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
```
