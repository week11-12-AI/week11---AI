-- Phase 1 시연용 SQL 파일 (진훈 기대값을 먼저 적고 실행한다)
INSERT INTO users VALUES ('kim', 31);
INSERT INTO users VALUES ('lee', 25);
INSERT INTO users VALUES ('park', 31);
SELECT * FROM users;
SELECT * FROM users WHERE id = 2;
SELECT * FROM users WHERE age = 31;
SELECT * FROM users WHERE name = 'choi';
INSERT INTO users VALUES ('kim');
SELECT name FROM users;
