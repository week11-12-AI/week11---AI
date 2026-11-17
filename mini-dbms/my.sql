-- 진훈 실험: 아래에 SQL 세 줄을 적는다 (한 줄에 하나)
-- 줄 위의 주석(--)에 예상을 적는다: OK 또는 에러

INSERT INTO users VALUES ('choi', 29);
-- 예상: OK

SELECT * FROM users WHERE age = 28;
-- 예상: error: no such column: age

INSERT INTO kor VALUES ('choi', 29);
-- 예상: error: no such table: kor
