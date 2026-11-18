/* 입구 ②: HTTP API 서버 (Phase 3)
 *
 *   ./build/server [-p 포트(8080)] [-t 워커 수(4)] [-d 데이터 폴더(data)]
 *
 *   POST /query    본문 = SQL 한 문장        → 200 결과 / 400 SQL 에러
 *   GET  /health                            → 200 ok
 *   그 밖                                    → 404 / 405 / 411 / 413 / 503
 *
 * 구조: 메인 스레드는 accept 만 하고, 받은 연결(fd)을 작업 큐에 넣는다.
 *       워커 스레드 n개가 큐에서 하나씩 꺼내 요청을 읽고 → db_execute → 응답하고 닫는다.
 *       엔진은 db_execute 안의 잠금 하나로 보호된다 (engine.c).
 *
 * 레디스 server.c 와 다른 점: 스레드가 여러 개라서
 *   ① 작업 큐를 여러 스레드가 같이 만진다 → 뮤텍스 + 조건 변수
 *   ② 엔진을 여러 스레드가 같이 부른다 → 엔진 잠금 */
#define _POSIX_C_SOURCE 200809L
#include <arpa/inet.h>
#include <errno.h>
#include <netinet/in.h>
#include <pthread.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>

#include "engine.h"

#define QUEUE_CAP   64          /* 기다릴 수 있는 연결 수. 넘치면 503 */
#define MAX_HEADER  8192        /* 요청 머리 최대 크기 */
#define MAX_BODY    4096        /* SQL 본문 최대 크기 */
#define MAX_WORKERS 64

/* ---------- 작업 큐: 원형 배열 + 뮤텍스 + 조건 변수 ---------- */

typedef struct {
    int fds[QUEUE_CAP];
    int head, count;
    int closed;                 /* 1이면 더 이상 넣지 않음 → 워커가 남은 것만 처리하고 끝남 */
    pthread_mutex_t lock;
    pthread_cond_t not_empty;
} job_queue;

static job_queue Q = { .lock = PTHREAD_MUTEX_INITIALIZER, .not_empty = PTHREAD_COND_INITIALIZER };

/* 넣기: 꽉 차 있으면 -1 (호출한 쪽이 503 으로 거절) */
static int queue_push(int fd) {
    pthread_mutex_lock(&Q.lock);
    if (Q.count == QUEUE_CAP || Q.closed) {
        pthread_mutex_unlock(&Q.lock);
        return -1;
    }
    Q.fds[(Q.head + Q.count) % QUEUE_CAP] = fd;
    Q.count++;
    pthread_cond_signal(&Q.not_empty);   /* 자고 있는 워커 하나 깨우기 */
    pthread_mutex_unlock(&Q.lock);
    return 0;
}

/* 꺼내기: 비어 있으면 잔다. 닫혔고 비었으면 -1 (워커 종료) */
static int queue_pop(void) {
    pthread_mutex_lock(&Q.lock);
    while (Q.count == 0 && !Q.closed)
        pthread_cond_wait(&Q.not_empty, &Q.lock);   /* 잠금을 풀고 자다가, 깨면 다시 잠금 */
    if (Q.count == 0) {
        pthread_mutex_unlock(&Q.lock);
        return -1;
    }
    int fd = Q.fds[Q.head];
    Q.head = (Q.head + 1) % QUEUE_CAP;
    Q.count--;
    pthread_mutex_unlock(&Q.lock);
    return fd;
}

static void queue_close(void) {
    pthread_mutex_lock(&Q.lock);
    Q.closed = 1;
    pthread_cond_broadcast(&Q.not_empty);   /* 자는 워커 전부 깨워서 끝내게 */
    pthread_mutex_unlock(&Q.lock);
}

/* ---------- HTTP ---------- */

static int write_all(int fd, const char *buf, size_t len) {
    while (len > 0) {
        ssize_t n = write(fd, buf, len);
        if (n < 0) {
            if (errno == EINTR) continue;
            return -1;
        }
        buf += n;
        len -= (size_t)n;
    }
    return 0;
}

/* 응답 한 번에 보내기: 머리 + 본문을 한 버퍼로 (작은 write 두 번은 지연이 생길 수 있다) */
static int respond(int fd, int status, const char *reason, const char *body) {
    size_t blen = strlen(body);
    char head[256];
    int hlen = snprintf(head, sizeof head,
                        "HTTP/1.1 %d %s\r\n"
                        "Content-Type: text/plain; charset=utf-8\r\n"
                        "Content-Length: %zu\r\n"
                        "Connection: close\r\n\r\n",
                        status, reason, blen + 1);
    char *msg = malloc((size_t)hlen + blen + 1);
    if (msg == NULL) return -1;
    memcpy(msg, head, (size_t)hlen);
    memcpy(msg + hlen, body, blen);
    msg[hlen + blen] = '\n';
    int r = write_all(fd, msg, (size_t)hlen + blen + 1);
    free(msg);
    return r;
}

/* 머리에서 "Content-Length: 123" 을 찾는다. 없으면 -1, 숫자가 이상하면 -2 */
static long content_length(const char *head) {
    const char *p = head;
    while ((p = strchr(p, '\n')) != NULL) {
        p++;
        if (strncasecmp(p, "Content-Length:", 15) == 0) {
            char *end;
            errno = 0;
            long n = strtol(p + 15, &end, 10);
            while (*end == ' ' || *end == '\t') end++;
            if (errno || n < 0 || (*end != '\r' && *end != '\n')) return -2;
            return n;
        }
    }
    return -1;
}

/* 연결 하나 처리: 요청 읽기 → 판정 → (필요하면) 엔진 → 응답 */
static int handle(db *d, int fd) {
    char buf[MAX_HEADER + 4 + MAX_BODY + 1];   /* 머리 + "\r\n\r\n" + 본문 + '\0' */
    size_t used = 0;
    char *body = NULL;

    /* ① 머리 끝(\r\n\r\n)이 올 때까지 읽기 */
    while (body == NULL) {
        if (used >= MAX_HEADER) return respond(fd, 413, "Payload Too Large", "(error) 요청 머리가 너무 큼");
        ssize_t n = read(fd, buf + used, sizeof buf - 1 - used);
        if (n <= 0) return -1;                      /* 끊김 또는 시간 초과 → 그냥 닫기 */
        used += (size_t)n;
        buf[used] = '\0';
        char *sep = strstr(buf, "\r\n\r\n");
        if (sep != NULL) {
            *sep = '\0';
            body = sep + 4;
        }
    }

    /* ② 요청 줄: "POST /query HTTP/1.1" */
    char method[8], path[64];
    if (sscanf(buf, "%7s %63s", method, path) != 2)
        return respond(fd, 400, "Bad Request", "(error) 요청 줄이 이상함");

    if (strcmp(path, "/health") == 0) {
        if (strcmp(method, "GET") != 0) return respond(fd, 405, "Method Not Allowed", "(error) GET 만");
        return respond(fd, 200, "OK", "ok");
    }
    if (strcmp(path, "/query") != 0) return respond(fd, 404, "Not Found", "(error) 없는 경로 (POST /query, GET /health)");
    if (strcmp(method, "POST") != 0) return respond(fd, 405, "Method Not Allowed", "(error) POST 만");

    /* ③ 본문: Content-Length 만큼 다 읽기 */
    long len = content_length(buf);
    if (len == -1) return respond(fd, 411, "Length Required", "(error) Content-Length 필요");
    if (len == -2) return respond(fd, 400, "Bad Request", "(error) Content-Length 가 이상함");
    if (len > MAX_BODY) return respond(fd, 413, "Payload Too Large", "(error) SQL 이 너무 김");
    size_t have = used - (size_t)(body - buf);
    while (have < (size_t)len) {
        ssize_t n = read(fd, body + have, (size_t)len - have);
        if (n <= 0) return -1;
        have += (size_t)n;
    }
    body[len] = '\0';

    /* 앞뒤 공백·줄바꿈 정리 (curl 이 붙이는 끝 줄바꿈 등) */
    while (*body == ' ' || *body == '\t' || *body == '\r' || *body == '\n') body++;
    size_t blen = strlen(body);
    while (blen > 0 && strchr(" \t\r\n", body[blen - 1]) != NULL) body[--blen] = '\0';
    if (blen == 0) return respond(fd, 400, "Bad Request", "(error) 빈 SQL");

    /* ④ 엔진 */
    char *r = db_execute(d, body);
    if (r == NULL) return respond(fd, 500, "Internal Server Error", "(error) 메모리 부족");
    int status = strncmp(r, "(error)", 7) == 0 ? 400 : 200;
    int w = respond(fd, status, status == 200 ? "OK" : "Bad Request", r);
    free(r);
    return w;
}

/* ---------- 워커와 메인 ---------- */

static db *DB;

static void *worker(void *arg) {
    (void)arg;
    int fd;
    while ((fd = queue_pop()) >= 0) {   /* 큐가 닫히고 빌 때까지 */
        handle(DB, fd);
        close(fd);
    }
    return NULL;
}

static volatile sig_atomic_t stop = 0;
static void on_signal(int sig) {
    (void)sig;
    stop = 1;
}

int main(int argc, char **argv) {
    int port = 8080, nworkers = 4;
    const char *dir = "data";
    int opt;
    while ((opt = getopt(argc, argv, "p:t:d:")) != -1) {
        if (opt == 'p') port = atoi(optarg);
        else if (opt == 't') nworkers = atoi(optarg);
        else if (opt == 'd') dir = optarg;
        else {
            fprintf(stderr, "사용법: %s [-p 포트] [-t 워커 수] [-d 데이터 폴더]\n", argv[0]);
            return 1;
        }
    }
    if (port <= 0 || port > 65535 || nworkers < 1 || nworkers > MAX_WORKERS) {
        fprintf(stderr, "포트는 1~65535, 워커 수는 1~%d\n", MAX_WORKERS);
        return 1;
    }

    signal(SIGPIPE, SIG_IGN);               /* 끊긴 연결에 쓰다가 죽지 않게 */
    struct sigaction sa = { 0 };
    sa.sa_handler = on_signal;              /* SA_RESTART 없음: accept 가 EINTR 로 깨어나 종료 */
    sigaction(SIGINT, &sa, NULL);
    sigaction(SIGTERM, &sa, NULL);

    DB = db_open(dir);
    if (DB == NULL) {
        fprintf(stderr, "데이터 폴더를 열 수 없음: %s\n", dir);
        return 1;
    }
    db_set_sync(DB, 1);                     /* 응답한 INSERT 는 서버가 죽어도 파일에 남게 */

    int lfd = socket(AF_INET, SOCK_STREAM, 0);
    int yes = 1;
    setsockopt(lfd, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof yes);
    struct sockaddr_in addr = { .sin_family = AF_INET, .sin_port = htons((uint16_t)port) };
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (bind(lfd, (struct sockaddr *)&addr, sizeof addr) < 0 || listen(lfd, 128) < 0) {
        perror("bind/listen");
        db_close(DB);
        return 1;
    }

    pthread_t th[MAX_WORKERS];
    for (int i = 0; i < nworkers; i++) pthread_create(&th[i], NULL, worker, NULL);
    printf("mini-dbms 서버: http://127.0.0.1:%d (워커 %d개, 데이터 %s)\n", port, nworkers, dir);
    fflush(stdout);

    while (!stop) {
        int cfd = accept(lfd, NULL, NULL);
        if (cfd < 0) {
            if (errno == EINTR) continue;
            perror("accept");
            break;
        }
        struct timeval tv = { .tv_sec = 5 };   /* 느리거나 멈춘 클라이언트가 워커를 붙잡지 않게 */
        setsockopt(cfd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);
        if (queue_push(cfd) < 0) {             /* 큐가 꽉 참 → 바로 거절 */
            respond(cfd, 503, "Service Unavailable", "(error) 서버가 바쁨");
            close(cfd);
        }
    }

    /* 정상 종료: 새 연결 그만 → 남은 요청 처리 → 워커 종료 → 파일 닫기 */
    close(lfd);
    queue_close();
    for (int i = 0; i < nworkers; i++) pthread_join(th[i], NULL);
    db_close(DB);
    printf("서버 종료\n");
    return 0;
}
