/* 계단 5: APP. 같은 요청("날씨")을 10번 보내고 걸린 시간을 잰다.
 *
 * [레디스 없이]  매번 느린 API에 묻는다
 * [레디스 쓰고]  cache-aside:
 *     GET 날씨 → 레디스
 *       ├ 있음 (hit)  → 그 값을 쓴다
 *       └ 없음 (miss) → 느린 API에 묻고 → SET 날씨 <값> EX 60 → 그 값을 쓴다
 *
 * 실행 전에 레디스 서버(6379)와 느린 API 서버(8000)가 켜져 있어야 한다. */
#define _POSIX_C_SOURCE 200809L

#include <arpa/inet.h>
#include <netinet/in.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

#define REDIS_PORT 6379
#define API_PORT   8000
#define REPEAT     10
#define KEY        "날씨"

static double now_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1000.0 + ts.tv_nsec / 1000000.0;
}

/* 127.0.0.1:port 에 연결해서 fd를 돌려준다. 실패하면 -1 */
static int connect_to(int port) {
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    struct sockaddr_in addr;
    memset(&addr, 0, sizeof addr);
    addr.sin_family = AF_INET;
    addr.sin_port = htons((unsigned short)port);
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (fd < 0 || connect(fd, (struct sockaddr *)&addr, sizeof addr) != 0) {
        return -1;
    }
    return fd;
}

/* 한 줄 보내고, 답 한 줄을 받아 out에 담는다 (줄 끝 \r\n은 뺀다). 성공 0, 실패 -1 */
static int ask(int fd, const char *line, char *out, size_t size) {
    char req[512];
    int len = snprintf(req, sizeof req, "%s\n", line);
    if (write(fd, req, (size_t)len) != len) {
        return -1;
    }
    size_t used = 0;
    while (used < size - 1) {
        ssize_t n = read(fd, out + used, size - 1 - used);
        if (n <= 0) {
            return -1;
        }
        used += (size_t)n;
        out[used] = '\0';
        char *nl = strchr(out, '\n');
        if (nl != NULL) {
            *nl = '\0';
            if (nl > out && nl[-1] == '\r') {
                nl[-1] = '\0';
            }
            return 0;
        }
    }
    return -1;
}

int main(void) {
    int redis = connect_to(REDIS_PORT);
    int api = connect_to(API_PORT);
    if (redis < 0 || api < 0) {
        fprintf(stderr, "연결 실패: 레디스 서버(%d)와 느린 API 서버(%d)를 먼저 켜세요\n",
                REDIS_PORT, API_PORT);
        return 1;
    }
    char value[512], reply[512], cmd[600];

    /* [레디스 없이] */
    printf("[레디스 없이] 같은 요청 %d번\n", REPEAT);
    double total_without = 0;
    for (int i = 1; i <= REPEAT; i++) {
        double t0 = now_ms();
        ask(api, KEY, value, sizeof value);
        double dt = now_ms() - t0;
        total_without += dt;
        printf("  %2d번째  %8.2f ms  (느린 API)\n", i, dt);
    }

    /* [레디스 쓰고] 시작 전에 레디스를 비워서 첫 요청이 miss가 되게 한다 */
    ask(redis, "DEL " KEY, reply, sizeof reply);
    printf("\n[레디스 쓰고] 같은 요청 %d번 (cache-aside)\n", REPEAT);
    double total_with = 0;
    int hits = 0;
    for (int i = 1; i <= REPEAT; i++) {
        double t0 = now_ms();
        ask(redis, "GET " KEY, value, sizeof value);
        int hit = strcmp(value, "(nil)") != 0;
        if (!hit) {                                                  /* miss */
            ask(api, KEY, value, sizeof value);
            snprintf(cmd, sizeof cmd, "SET %s %s EX 60", KEY, value);
            ask(redis, cmd, reply, sizeof reply);
        }
        double dt = now_ms() - t0;
        total_with += dt;
        hits += hit;
        printf("  %2d번째  %8.2f ms  (%s)\n", i, dt,
               hit ? "hit: 레디스" : "miss: 느린 API → 레디스에 저장");
    }

    printf("\n결과: 레디스 없이 %.2f ms / 레디스 쓰고 %.2f ms (hit %d번, miss %d번)\n",
           total_without, total_with, hits, REPEAT - hits);
    close(redis);
    close(api);
    return 0;
}
