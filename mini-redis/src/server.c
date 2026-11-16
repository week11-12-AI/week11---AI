/* 계단 3: 네트워크. APP과 소켓으로 글자를 주고받고, 가운데(③)는 execute_line에 맡긴다.
 *
 * 바깥 루프 (서버가 꺼질 때까지)
 * │  ① APP 연결 기다리기 (accept)
 * │  안쪽 루프 (serve, APP이 연결을 유지하는 동안)
 * │  │  ② 한 줄 읽기 (read)   ── 0글자면 APP이 끊은 것 → 탈출
 * │  │  ③ execute_line(줄)    ── 계단 2 그대로
 * │  │  ④ 답 보내기 (write)
 * │  └  ⑤ ②로
 * └  연결 닫기 → ①로
 */
#define _POSIX_C_SOURCE 200809L

#include <arpa/inet.h>
#include <netinet/in.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

#include "command.h"

#define PORT     6379   /* 진짜 레디스와 같은 번호 */
#define MAX_LINE 1024   /* 명령 한 줄의 최대 길이 */

/* 글자를 끝까지 다 보낸다 (write는 한 번에 일부만 보낼 수도 있어서 반복) */
static int write_all(int fd, const char *s, size_t len) {
    while (len > 0) {
        ssize_t n = write(fd, s, len);
        if (n <= 0) {
            return -1;
        }
        s += n;
        len -= (size_t)n;
    }
    return 0;
}

/* ④ 답 한 줄 보내기: 답 + "\r\n" */
static int send_line(int fd, const char *reply) {
    if (write_all(fd, reply, strlen(reply)) != 0) {
        return -1;
    }
    return write_all(fd, "\r\n", 2);
}

/* 안쪽 루프: 한 APP과 연결이 유지되는 동안 ②③④⑤를 돈다.
 * 소켓은 글자에 경계가 없어서, read 한 번에 반 줄이 올 수도 두 줄이 올 수도 있다.
 * 그래서 buf에 모아 두고 '\n'이 보일 때마다 그 앞까지를 명령 한 줄로 처리한다. */
static void serve(hashtable *t, int fd) {
    char buf[MAX_LINE + 1];
    size_t used = 0;   /* buf에 모인 글자 수 */

    for (;;) {
        ssize_t n = read(fd, buf + used, MAX_LINE - used);   /* ② */
        if (n <= 0) {
            return;   /* 0 = APP이 연결을 끊음, 음수 = 오류 */
        }
        used += (size_t)n;

        char *start = buf;
        char *nl;
        while ((nl = memchr(start, '\n', used - (size_t)(start - buf))) != NULL) {
            *nl = '\0';   /* 한 줄로 끊기 (\r은 execute_line이 버린다) */
            printf("  [② 읽음] %s\n", start);

            char *reply = execute_line(t, start);                /* ③ */
            const char *out = reply != NULL ? reply : "(error) 메모리 부족";
            printf("  [④ 보냄] %s\n", out);
            int sent = send_line(fd, out);                       /* ④ */
            free(reply);   /* execute_line이 malloc한 답: 보냈으면 버린다 */
            if (sent != 0) {
                return;
            }
            start = nl + 1;   /* ⑤ 다음 줄로 */
        }

        /* 아직 '\n'이 안 온 나머지 글자는 buf 맨 앞으로 옮겨 두고 더 읽는다 */
        used -= (size_t)(start - buf);
        memmove(buf, start, used);
        if (used == MAX_LINE) {
            send_line(fd, "(error) 줄이 너무 김");
            return;
        }
    }
}

int main(void) {
    /* APP이 먼저 끊은 뒤 write 하면 OS가 서버를 죽이는 신호(SIGPIPE)를 보낸다 → 무시하고 write 실패로 처리 */
    signal(SIGPIPE, SIG_IGN);

    hashtable *t = ht_create(1024);
    if (t == NULL) {
        fprintf(stderr, "해시 테이블을 만들 수 없음\n");
        return 1;
    }

    /* OS에게 통로 입구를 하나 만들어 달라고 한다 */
    int listen_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (listen_fd < 0) {
        perror("socket");
        return 1;
    }
    /* 서버를 껐다 바로 다시 켜도 같은 포트를 쓸 수 있게 */
    int yes = 1;
    setsockopt(listen_fd, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof yes);

    /* "이 컴퓨터(127.0.0.1)의 6379번으로 오는 연결은 나한테 줘" */
    struct sockaddr_in addr;
    memset(&addr, 0, sizeof addr);
    addr.sin_family = AF_INET;
    addr.sin_port = htons(PORT);
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (bind(listen_fd, (struct sockaddr *)&addr, sizeof addr) != 0) {
        perror("bind");
        return 1;
    }
    if (listen(listen_fd, 16) != 0) {
        perror("listen");
        return 1;
    }
    printf("[시작] 127.0.0.1:%d 에서 APP을 기다림 (끄려면 Ctrl+C)\n", PORT);

    for (;;) {   /* 바깥 루프 */
        printf("[① 연결 기다림]\n");
        fflush(stdout);
        int fd = accept(listen_fd, NULL, NULL);
        if (fd < 0) {
            perror("accept");
            continue;
        }
        printf("[연결됨] fd = %d\n", fd);
        serve(t, fd);
        close(fd);
        printf("[연결 닫음] APP이 끊음\n");
    }
}
