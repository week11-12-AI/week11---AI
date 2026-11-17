"""서버가 실행되는 동안 랜덤 도전과 소요 시간을 관리한다."""
import random
import time
from threading import RLock
from uuid import uuid4
from .errors import check

CHALLENGE = {"id": "challenge-01", "title": "공통 도전 · 랜덤", "scrambleSize": 5}
ATTEMPT_TTL = 24 * 60 * 60


def affected_cells(index):
    row, column = divmod(index, 5)
    return [index] + ([index - 5] if row else []) + ([index + 5] if row < 4 else []) + ([index - 1] if column else []) + ([index + 1] if column < 4 else [])


MASKS = [sum(1 << cell for cell in affected_cells(index)) for index in range(25)]


def board_for(scramble):
    board = 0
    for move in scramble:
        board ^= MASKS[move]
    return board


# 서버에서 클릭을 재현해 모든 불이 꺼졌는지, 성공 이후 불필요한 이동이 없는지 검사한다.
def validate_solution(moves, scramble):
    check(isinstance(moves, list) and 1 <= len(moves) <= 1000
          and all(type(move) is int and 0 <= move < 25 for move in moves),
          "MOVES", "클릭 기록은 0~24의 정수로 1~1,000개여야 합니다.")
    board = board_for(scramble)
    for move in moves:
        check(board != 0, "MOVES", "성공 이후의 불필요한 이동이 포함되었습니다.")
        board ^= MASKS[move]
    check(board == 0, "NOT_SOLVED", "아직 모든 불을 끄지 못했습니다.")
    return len(moves)


class ChallengeAttempts:
    def __init__(self, clock=time.monotonic, rng=None, capacity=4096):
        self.clock, self.rng, self.capacity = clock, rng or random.SystemRandom(), capacity
        self.lock = RLock()
        self.attempts = {}
        self.last_board = None

    def _prune(self):
        now = self.clock()
        self.attempts = {key: value for key, value in self.attempts.items() if now - value["created"] < ATTEMPT_TTL}

    def _find(self, attempt_id):
        self._prune()
        check(isinstance(attempt_id, str) and attempt_id in self.attempts,
              "ATTEMPT_EXPIRED", "도전 정보가 만료되었습니다. 공통 도전을 다시 시작하세요.", 410)
        return self.attempts[attempt_id]

    # 풀 수 있는 배치와 도전 ID를 발급한다. 재도전은 같은 배치를 사용한다.
    def start(self, restart_id=None):
        with self.lock:
            self._prune()
            check(len(self.attempts) < self.capacity, "SERVER_BUSY", "도전 요청이 많습니다. 잠시 후 다시 시도하세요.", 503)
            if restart_id is not None:
                scramble = list(self._find(restart_id)["scramble"])
            else:
                while True:
                    scramble = self.rng.sample(range(25), 5)
                    board = board_for(scramble)
                    if board and board != self.last_board:
                        self.last_board = board
                        break
            attempt_id = uuid4().hex
            self.attempts[attempt_id] = dict(scramble=scramble, created=self.clock(), started=None, solution=None, elapsed_ms=None, record=None)
            return {**CHALLENGE, "attemptId": attempt_id, "scramble": list(scramble)}

    # 첫 보드 클릭 요청에서 시간을 시작하며 재요청해도 시작 시각을 유지한다.
    def begin(self, attempt_id):
        with self.lock:
            attempt = self._find(attempt_id)
            if attempt["started"] is None:
                attempt["started"] = self.clock()
            elapsed = attempt["elapsed_ms"]
            if elapsed is None:
                elapsed = max(0, round((self.clock() - attempt["started"]) * 1000))
            return dict(attemptId=attempt_id, elapsedMs=elapsed)

    # 해답을 검증하고 서버 시계로 소요 시간을 확정한다. 재요청은 확정된 시간을 반환한다.
    def finish(self, attempt_id, moves):
        with self.lock:
            attempt = self._find(attempt_id)
            validate_solution(moves, attempt["scramble"])
            check(attempt["started"] is not None, "NOT_STARTED", "먼저 보드를 클릭해 시간 측정을 시작하세요.", 409)
            if attempt["solution"] is not None:
                check(moves == attempt["solution"], "ATTEMPT_FINISHED", "이미 완료한 도전입니다. 다시 시작해서 도전하세요.", 409)
            else:
                attempt["solution"] = list(moves)
                attempt["elapsed_ms"] = max(1, round((self.clock() - attempt["started"]) * 1000))
            return dict(attemptId=attempt_id, elapsedMs=attempt["elapsed_ms"], moves=len(moves))

    def register(self, attempt_id, nickname, save):
        # 검증된 결과를 save에 넘긴다. 같은 도전의 중복·동시 등록은 기존 결과를 반환한다.
        with self.lock:
            attempt = self._find(attempt_id)
            check(attempt["solution"] is not None, "NOT_FINISHED", "먼저 퍼즐을 완료하고 성공 확인을 받아야 합니다.", 409)
            if attempt["record"] is not None:
                check(nickname == attempt["nickname"], "ALREADY_REGISTERED", "이미 다른 닉네임으로 등록한 도전입니다.", 409)
                return attempt["record"]
            result = save(len(attempt["solution"]), attempt["elapsed_ms"])
            attempt["nickname"], attempt["record"] = nickname, result
            return result
