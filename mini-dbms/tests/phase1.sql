-- Phase 1 기능 테스트: CLI 에 SQL 파일을 넣어 실행한다
INSERT INTO users VALUES ('kim', 31);
INSERT INTO users VALUES ('lee', 25);
INSERT INTO users VALUES ('park', 31);
SELECT * FROM users;
SELECT * FROM users WHERE id = 2;
SELECT * FROM users WHERE age = 31;
SELECT * FROM users WHERE name = 'nobody';

-- 에러: 모양(파서)과 뜻(실행기)
INSERT INTO users VALUES ('kim');
INSERT INTO users VALUES ('kim', 'x');
SELECT name FROM users;
SELECT * FROM orders;
