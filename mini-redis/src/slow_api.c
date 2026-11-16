/* 계단 5: 느린 API 서버 (가짜 원본). 느린 DB나 외부 API를 흉내 낸다.
 * 구조는 server.c와 같다 (① accept → ② read → ③ → ④ write). ③만 다르다:
 *   ③ 1초 쉬고 → 답 만들기
 * 요청: key 한 줄 (예: "날씨\n")  →  답: "<key>-원본데이터\r\n" (예: "날씨-원본데이터") */
#define _POSIX_C_SOURCE 200809L

#include <arpa/inet.h>
#include <netinet/in.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

#define PORT     8000
#define MAX_LINE 1024
#define DELAY_MS 1000   /* 원본이 느린 정도 */

static void sleep_ms(long ms) {
    struct timespec ts = { ms / 1000, (ms % 1000) * 1000000L };
    nanosleep(&ts, NULL);
}

/* 안쪽 루프: 한 줄 받을 때마다 1초 쉬고 답한다 */
static void serve(int fd) {
    char buf[MAX_LINE + 1];
    size_t used = 0;
    for (;;) {
        ssize_t n = read(fd, buf + used, MAX_LINE - used);          /* ② */
        if (n <= 0) {
            return;
        }
        used += (size_t)n;
        char *start = buf;
        char *nl;
        while ((nl = memchr(start, '\n', used - (size_t)(start - buf))) != NULL) {
            *nl = '\0';
            if (nl > start && nl[-1] == '\r') {
                nl[-1] = '\0';
            }
            sleep_ms(DELAY_MS);                                      /* ③ 느린 원본 */
            char reply[MAX_LINE + 32];
            int len = snprintf(reply, sizeof reply, "%s-원본데이터\r\n", start);
            printf("  [느린 API] %s → %d ms 쉬고 답함\n", start, DELAY_MS);
            fflush(stdout);
            if (write(fd, reply, (size_t)len) != len) {               /* ④ */
                return;
            }
            start = nl + 1;
        }
        used -= (size_t)(start - buf);
        memmove(buf, start, used);
        if (used == MAX_LINE) {
            return;
        }
    }
}

int main(void) {
    signal(SIGPIPE, SIG_IGN);
    int listen_fd = socket(AF_INET, SOCK_STREAM, 0);
    int yes = 1;
    setsockopt(listen_fd, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof yes);
    struct sockaddr_in addr;
    memset(&addr, 0, sizeof addr);
    addr.sin_family = AF_INET;
    addr.sin_port = htons(PORT);
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (bind(listen_fd, (struct sockaddr *)&addr, sizeof addr) != 0 || listen(listen_fd, 16) != 0) {
        perror("bind/listen");
        return 1;
    }
    printf("[느린 API 시작] 127.0.0.1:%d, 답하기 전에 %d ms 쉼\n", PORT, DELAY_MS);
    fflush(stdout);
    for (;;) {                                                        /* 바깥 루프 */
        int fd = accept(listen_fd, NULL, NULL);                       /* ① */
        if (fd < 0) {
            continue;
        }
        serve(fd);
        close(fd);
    }
}
