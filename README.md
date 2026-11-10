# Mini React — DOM 실험실

React의 화면 갱신 원리를 Vanilla JavaScript로 구현하는 학습 프로젝트입니다. Phase 1에서는 실제 DOM을 Virtual DOM으로 변환하고, 이전·새 트리의 차이를 계산해 필요한 변경만 실제 DOM에 적용합니다. React·Vue 등의 UI 프레임워크는 사용하지 않습니다.

## 실행

Node.js 18 이상이 필요합니다. 의존성이 없다면 `npm ci`로 설치한 뒤 실행합니다.

```sh
npm run dev
```

터미널에 표시된 로컬 주소를 엽니다.

```sh
npm test          # VDOM·Diff·Patch 단위 테스트
npm run test:e2e # 실제 Chrome 편집·히스토리 테스트
npm run build    # dist/에 배포용 정적 파일 생성
```

브라우저 테스트는 설치된 Google Chrome을 사용합니다(`playwright.config.js`의 `channel: "chrome"`). 개발 서버는 테스트가 시작할 때 자동으로 실행됩니다.

## 사용 방법

1. 왼쪽 **실제 영역**은 마지막으로 적용한 상태입니다. 오른쪽 **테스트 영역**에서 글자를 직접 편집하거나 입력값·체크 상태를 바꿉니다.
2. 요소를 클릭하거나 **요소 목록**에서 선택합니다. 파란 테두리가 선택을 표시합니다. **부모 선택**으로 중첩 요소의 부모를 선택할 수 있습니다.
3. **요소 추가**는 선택 요소와 같은 부모 안에서 바로 뒤에 삽입합니다. 선택이 없으면 루트 마지막에 추가합니다. 태그와 내용/입력값을 지정할 수 있습니다.
4. **앞으로 이동 / 뒤로 이동**은 같은 부모 안에서 형제 노드를 한 칸씩 이동합니다. **요소 삭제**는 선택 요소와 그 자식을 삭제합니다.
5. 속성을 선택하고 값을 입력한 뒤 **속성 설정 / 속성 삭제**를 누릅니다. class, title, id, placeholder, aria-label, value, checked, disabled, type을 지원합니다. `checked`·`disabled`는 값과 관계없이 속성의 존재가 켜짐을 뜻합니다. `type`은 input의 text·checkbox만 지원합니다.
6. **변경 목록**을 보고 **Patch 적용**을 누릅니다. 변경 없는 DOM과 key가 같은 이동 요소는 재사용합니다. 변경이 없으면 히스토리를 추가하지 않습니다.
7. **뒤로 / 앞으로**로 적용한 상태를 양쪽 영역에 복원합니다. 미적용 편집이 있으면 버릴지 확인하며, 취소하면 편집을 유지합니다. 뒤로 이동한 뒤 새 Patch를 적용하면 이후 기록은 제거됩니다.

## key와 직접 편집

- 초기 요소와 새로 추가한 요소에는 자동으로 고유한 `data-key`를 부여합니다. 직접 편집으로 생긴 요소의 key가 빠져 있으면 자동으로 보충합니다.
- 같은 부모 아래 중복 key가 있으면 빨간 점선과 오류를 표시하고 Patch를 차단합니다. 충돌 요소를 선택해 **새 key 발급** 또는 고유한 **key 설정**으로 해결합니다. 브라우저가 Enter로 요소를 나누면서 key를 복제해도 같은 절차로 해결합니다.
- key를 바꾸면 Diff에서는 다른 요소로 취급하므로 기존 DOM이 교체될 수 있습니다.
- 붙여넣기는 일반 텍스트로 처리하고 드래그로 HTML을 삽입하는 동작은 막습니다. 루트 자체는 편집 도구로 삭제하거나 선택하지 않습니다. 전체 선택 후 내용 삭제는 가능합니다.
- 선택·충돌 표시는 외부 스타일로 처리해 저장하는 VDOM에 편집 도구의 상태가 섞이지 않습니다.

## 동작 구조

```text
실제 DOM → domToVNode → 초기 VDOM → createDOM → 테스트 DOM
                                                    ↓ 사용자 편집
현재 스냅샷 ← 히스토리              테스트 DOM → domToVNode
      └──────────────────── diff ───────────────────┘
                              ↓ 변경 목록
                            patch → 실제 DOM
                              ↓ 성공 후 새 스냅샷 저장
```

| 파일 | 역할 |
| --- | --- |
| `src/vdom.js` | 요소·텍스트·속성·key·현재 폼 상태를 VDOM으로 변환하고 DOM으로 복원 |
| `src/diff.js` | 텍스트·속성·폼 상태·추가·삭제·교체·key 기반 이동 비교, 형제 중복 key 검증 |
| `src/patch.js` | 변경 전 경로로 DOM 참조를 먼저 확보하고 변경 적용, 이동 시 포커스·선택 범위 보존 |
| `src/main.js` | 직접 편집, 선택·편집 도구, key 관리, 변경 미리보기, 스냅샷 히스토리 연결 |
| `src/style.css` | 데스크톱 두 열 및 좁은 화면 한 열 배치 |
| `tests/*.test.js` | 엔진 단위 테스트 |
| `tests/e2e/editor.spec.js` | 실제 Chrome에서 편집·key·히스토리·DOM 유지·화면 배치 검증 |

## 지원 범위

VDOM은 요소와 텍스트 노드를 지원합니다. input의 현재 value·checked, textarea의 value, 단일 select의 value, option의 selected를 보관합니다. 파일 선택값은 복원하지 않습니다. 편집 UI의 추가 태그는 p, h3, div, span, strong, button, input, textarea, ul, li입니다. 다중 선택 select와 이벤트 핸들러 편집은 제공하지 않습니다.

히스토리는 현재 페이지의 메모리에 보관하며 새로고침하면 초기화됩니다.

## Phase 2 첫 단계 — JSX와 VDOM

Phase 1 화면 상단의 링크로 `/phase2.html`을 엽니다. JSX 원문, 변환되는 h() 호출, 반환된 VDOM 객체, 실제 화면을 순서대로 볼 수 있습니다.

- `vite.config.js`: JSX를 React 없이 자체 `h()` 호출로 변환하고 두 HTML 페이지를 빌드합니다.
- `src/h.js`: 태그·props·자식을 기존 VDOM 형식으로 옮깁니다. className은 class로 저장합니다.
- `src/phase2.jsx`: JSX 제목을 만들고 기존 createDOM()으로 표시합니다.

현재 학습 범위에 맞춰 정적 HTML 요소 생성까지만 구현했습니다. 함수형 컴포넌트·이벤트·State·Hooks·할 일 앱은 이후 단계입니다. 진행 기록은 [Phase 2 진행](notes/phase2-progress.md)을 참고하세요.

설계와 결정은 [Phase 1 설계](notes/phase1-design.md), 구현·검증 기록은 [Phase 1 진행](notes/phase1-progress.md)을 참고하세요.
