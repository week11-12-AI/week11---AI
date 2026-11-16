#ifndef COMMAND_H
#define COMMAND_H

#include "hashtable.h"

/* APP이 보낸 명령 한 줄을 받아 자르고, 검사하고, 해시 테이블 함수를 부르고, 답 한 줄을 만든다.
 * 답은 malloc으로 만든 새 글자다. 받은 쪽(서버 코드, 테스트 코드)이 다 쓰고 free 한다.
 * 메모리가 없으면 NULL. */
char *execute_line(hashtable *t, const char *line);

#endif
