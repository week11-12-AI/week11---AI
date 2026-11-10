# Phase 2 구현 현황

## 현재 구현 범위

사용자는 전체 설계의 일괄 구현 대신 지금까지 학습한 부분까지만 구현하도록 범위를 좁혔다. 이에 따라 첫 단계인 JSX → h() → VDOM → createDOM()까지 구현했다.

- [x] Vite에서 JSX를 자체 h() 호출로 변환 (React 런타임·추가 의존성 없음)
- [x] h(): 태그·props·자식을 기존 VDOM으로 변환
- [x] className → class, key 분리, 텍스트·숫자·자식 VDOM 처리
- [x] 별도 phase2.html에서 JSX·함수 호출·VDOM 데이터·실제 결과 표시
- [x] Phase 1·2 상호 이동 링크와 두 페이지 production build
- [ ] 함수형 자식 컴포넌트와 이벤트 연결
- [ ] FunctionComponent·useState·useEffect·useMemo
- [ ] 할 일 목록·저장·생명주기 시연·학습 패널

아직 구현하지 않은 이벤트와 함수 태그를 h()에 전달하면 명시적으로 오류를 내며, 조용히 문자열 속성으로 변환하지 않는다.

## 검증 — 2026-11-10

- `npm test` — PASS, 기존 53개와 h() 2개를 합쳐 55개 통과.
- `npm run test:e2e` — PASS, 기존 Chrome 11개와 JSX 표시·페이지 이동 1개를 합쳐 12개 통과.
- `npm run build` — PASS, dist/index.html과 dist/phase2.html 생성.
- `git diff --check` — PASS, 추적 파일 기준. 미추적 파일은 직접 확인했다.

## 다음 단계

JSX가 VDOM 객체를 반환하는 과정을 공부한 뒤, 함수형 컴포넌트 지원과 클릭·입력 이벤트 연결을 진행한다. 전체 목표는 [Phase 2 설계](phase2-design.md)를 따른다.
