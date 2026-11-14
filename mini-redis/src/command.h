#ifndef COMMAND_H
#define COMMAND_H

#include "hashtable.h"

/* 손님 글자 한 줄을 받아 자르고, 검사하고, 보관함 함수를 부르고, 답 글자를 만든다.
 * 답은 malloc으로 만든 새 글자다. 다 쓴 쪽(손님 쪽 코드)이 free 한다.
 * 메모리가 없으면 NULL. */
char *execute_line(hashtable *t, const char *line);

#endif
