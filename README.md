# 🏢 2D Pixel Agent Dashboard (Virtual Office Monitor)

Gemini 기반의 Multi-Agent 시스템 동작 상태를 실시간으로 모니터링할 수 있는 **2D 픽셀 아트 가상 오피스 대시보드**입니다.
여러 AI 에이전트들의 생성, 추론(Thinking), 도구 실행(Typing/Working), 대기(Idle), 퇴근(Terminated) 상태가 픽셀 오피스 캔버스와 실시간 말풍선, 미니 콘솔 로그 뷰로 시각화됩니다.

---

## 🌟 주요 기능 (Key Features)

1. **2D 픽셀 아트 가상 오피스 (Pixel Canvas)**
   - 복수의 에이전트 워크스테이션(컴퓨터 책상), 휴게 공간(커피 머신, 정수기), 화이트보드, 출입문 타일맵 렌더링.
   - 상태별 캐릭터 애니메이션:
     - `walk`: 이동 및 다리 스윙 애니메이션
     - `thinking`: 생각에 잠긴 포즈 & 머리 위 물음표(`?`) 펄스
     - `typing`: 책상 키보드 고속 타이핑 & 도구 실행 기어(`⚙`) 표시
     - `idle`: 완료 후 대기 또는 휴식(`z`)
     - `terminated`: 태스크 완료 후 페이드아웃 및 퇴근
   - 실시간 말풍선/툴팁: 각 에이전트가 어떤 도구를 실행 중인지(`[search_codebase]`, `[write_file]`, `[run_bash]`) 즉각 머리 위에 렌더링.

2. **이벤트 브로커 & WebSocket 통신**
   - 백엔드(`/ws/agent-events`)를 통해 에이전트 라이프사이클 이벤트를 프론트엔드로 브로드캐스트.
   - 신규 접속 시 최근 상태 히스토리 자동 동기화.

3. **터미널 & 로그 스트리밍 패널**
   - 전체 에이전트 또는 특정 에이전트 필터링 선택 기능.
   - 실시간 도구 실행 로그 및 세부 파라미터 확인 가능.

4. **즉시 확인 가능한 Mock Simulation & Gemini 연동**
   - **Mock Runner**: 별도 API 키 없이 3명의 에이전트(Alice - 설계, Bob - 백엔드, Charlie - QA) 협업 시뮬레이션 즉시 구동 가능.
   - **Gemini Agent Wrapper**: Google GenAI SDK를 탑재하여 실제 프롬프트를 전송했을 때 Multi-turn 도구 호출과 서브에이전트 위임 과정을 시각화.

---

## 📁 프로젝트 구조 (Architecture)

```
2D_AI_AGENT/
├── backend/
│   ├── eventBroker.js        # WebSocket 이벤트 브로드캐스터
│   ├── server.js             # Express 서버 & REST/WS 엔드포인트
│   ├── mock/
│   │   └── mockRunner.js     # 3명 협업 Mock 시뮬레이션 시나리오
│   ├── gemini/
│   │   └── geminiAgent.js    # Google GenAI SDK 연동 및 Tool Call 래퍼
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── canvas/
│   │   │   ├── OfficeMap.ts      # 2D 픽셀 오피스 맵 & 가구 렌더러
│   │   │   ├── AgentRenderer.ts  # 픽셀 캐릭터, 애니메이션, 말풍선 렌더러
│   │   │   └── OfficeCanvas.tsx  # React Canvas 뷰 & 마우스 인터랙션
│   │   ├── components/
│   │   │   └── TerminalPanel.tsx # 에이전트별 터미널 로그 패널
│   │   ├── hooks/
│   │   │   └── useAgentSocket.ts # WebSocket 이벤트 수신 & 상태 동기화
│   │   ├── App.tsx               # 메인 레이아웃 및 디스패처
│   │   └── types.ts              # Agent 및 Event 인터페이스
│   └── package.json
└── README.md
```

---

## 🚀 빠른 시작 가이드 (Quick Start)

### 1. 백엔드 실행 (Backend)

새 터미널을 열고 다음 명령어를 실행합니다:

```bash
cd backend
npm install
npm start
```
- 서버 주소: `http://localhost:4000`
- WebSocket 주소: `ws://localhost:4000/ws/agent-events`

> **(선택 사항) Gemini API 키 설정:**
> 실제 Gemini 모델을 호출하려면 `backend/.env` 파일을 생성하고 키를 입력하세요:
> ```env
> GEMINI_API_KEY=your_api_key_here
> PORT=4000
> ```
> *키가 없어도 자체 폴백 시뮬레이터가 동작하므로 브라우저에서 바로 테스트할 수 있습니다.*

---

### 2. 프론트엔드 실행 (Frontend)

새 터미널을 열고 다음 명령어를 실행합니다:

```bash
cd frontend
npm install
npm run dev
```

브라우저에서 `http://localhost:5173` 을 엽니다.

---

## 🎮 시각적 테스트 방법

1. 브라우저 상단의 **"Run 3-Agent Mock"** 버튼을 클릭합니다.
2. 출입문에서 에이전트 3명이 순차적으로 스폰되어 각자의 책상으로 걸어갑니다:
   - **Alice (Software Architect)**: 요구사항 분석 후 코드 검색 및 아키텍처 문서 작성
   - **Bob (Backend Engineer)**: 설계 문서 리뷰 후 캐시 브로커 구현
   - **Charlie (QA & Security)**: 테스트 슈트 실행 및 검증 후 퇴근
3. 캐릭터 머리 위의 말풍선과 우측 터미널 패널에서 실시간 작업 내용과 도구 실행 로그를 관찰할 수 있습니다.
4. 하단 입력창에 프롬프트를 입력하고 **"Dispatch Task"**를 누르면 Gemini 에이전트 워크플로우를 트리거할 수 있습니다.
