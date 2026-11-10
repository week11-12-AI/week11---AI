# week11---AI

## 미니 React 실습

Vanilla JavaScript로 Virtual DOM, Diff, Patch와 루트 컴포넌트의 Hook을 구현했습니다. 같은 Diff와 Patch를 HTML 실험실과 좋아요·댓글 시연에서 사용합니다.

```powershell
npm run dev
```

브라우저에서 <http://127.0.0.1:4173>을 열면 됩니다. Node.js가 필요하며 npm 패키지를 설치할 필요는 없습니다.

### 시연 순서

1. **Phase 1**에서 테스트 영역의 제목을 바꾸고 목록에 항목을 넣습니다. **Patch 적용** 후 실제 영역의 변경과 `MutationObserver` 기록을 확인합니다. 뒤로가기·앞으로가기로 두 영역이 함께 복원됩니다. 뒤로 이동한 뒤 새 Patch를 적용하면 앞쪽 기록은 새 분기로 대체됩니다.
2. **Phase 2**에서 게시물 좋아요가 10이 되면 인기 배지가 추가됩니다. 댓글은 좋아요가 많은 순으로 정렬되며, 동점이면 먼저 등록한 댓글이 앞에 옵니다. 1위 댓글의 좋아요가 10개 이상이면 **인기 댓글**이 표시됩니다. 댓글에는 등록 시간이 표시되고, **답글**로 해당 댓글 아래에 대댓글을 달 수 있습니다.
3. **새로고침**하면 같은 브라우저에 저장한 게시물·댓글 좋아요, 댓글·대댓글과 초안, Phase 1의 적용 내용과 히스토리가 복원됩니다. `npm run dev` 서버를 종료하고 다시 실행하면 게시물 좋아요는 0, 댓글과 초안은 빈 상태, Phase 1은 처음 샘플로 돌아갑니다.

### 코드에서 동작 따라가기

| 파일 | 역할 |
| --- | --- |
| [`src/vdom.js`](src/vdom.js) | 실제 DOM 변환, 다섯 종류의 변경 계산, DOM 반영 |
| [`src/history.js`](src/history.js), [`src/lab.js`](src/lab.js) | 상태 기록과 HTML 편집·복원 화면 |
| [`src/component.js`](src/component.js) | `FunctionComponent`, `mount()`·`update()`, `useState`·`useEffect`·`useMemo` |
| [`src/demo.js`](src/demo.js) | 루트 상태와 props만 받는 자식 컴포넌트 |

```text
클릭 또는 입력 → 루트 상태 변경 → update() → 새 Virtual DOM → Diff → Patch → Effect 실행
```

### 테스트와 구현 범위

```powershell
npm test
```

Chrome 또는 Edge에서 DOM 변환·Diff·Patch·히스토리·Hook 단위 테스트와 두 Phase의 기능 테스트를 실행합니다. 브라우저가 다른 위치에 있으면 `BROWSER_PATH`에 실행 파일 경로를 지정하세요. 개발 서버를 켠 상태에서 <http://127.0.0.1:4173/tests/browser.html>로 결과를 직접 볼 수도 있습니다.

과제의 제약에 따라 Hook은 루트에만 두고 상태 변경마다 동기적으로 갱신합니다. Diff는 바뀌지 않은 앞뒤 자식을 보존하고 나머지는 위치 기준으로 비교합니다. 목록의 `key` 기반 재배치와 선택 과제인 Batching은 구현 범위 밖입니다. Phase 1 편집기는 일반적인 표시용 HTML과 SVG를 미리보기로 지원합니다.

참고: [학습 노트](https://github.com/hw-archive07/Learning-Content/blob/main/react-study-notes.md), [React useEffect](https://react.dev/reference/react/useEffect), [React useMemo](https://react.dev/reference/react/useMemo).
