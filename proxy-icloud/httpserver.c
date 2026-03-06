#include "debug.h"
#include "queue.h"
#include "rwlock.h"
#include "asgn2_helper_funcs.h"

#include <stdio.h>
#include <unistd.h>
#include <stdlib.h>
#include <regex.h>
#include <string.h>
#include <fcntl.h>
#include <signal.h>
#include <pthread.h>
#include <stdint.h>
#include <sys/stat.h>

#define OPTIONS "t:"

typedef struct file_lock {
    char *file_name;
    rwlock_t *rw;
    struct file_lock *next;
} file_lock_t;

queue_t *q;
file_lock_t *file_list;
pthread_mutex_t file_mutex;

rwlock_t *get_file_lock(char *file_name) {
    pthread_mutex_lock(&file_mutex);
    file_lock_t *curr = file_list;
    while (curr != NULL) {
        if (strcmp(curr->file_name, file_name) == 0) {
            pthread_mutex_unlock(&file_mutex);
            return curr->rw;
        }
        curr = curr->next;
    }

    file_lock_t *node = malloc(sizeof(file_lock_t));
    node->file_name = strdup(file_name);
    node->rw = rwlock_new(N_WAY, 1);
    node->next = file_list;
    file_list = node;

    pthread_mutex_unlock(&file_mutex);
    return node->rw;
}

void destroy_file_locks() {
    pthread_mutex_lock(&file_mutex);
    file_lock_t *curr = file_list;
    while (curr != NULL) {
        file_lock_t *temp = curr;
        curr = curr->next;
        free(temp->file_name);
        rwlock_delete(&temp->rw);
        free(temp);
    }
    file_list = NULL;
    pthread_mutex_unlock(&file_mutex);
}

void process_get(int fd, char *file_name, int request_id) {
    rwlock_t *rw = get_file_lock(file_name);
    reader_lock(rw);

    char response[2048];
    int response_length;

    struct stat file_stat;
    stat(file_name, &file_stat);

    int infile = open(file_name, O_RDONLY);

    //CHECK IF VALID FILE_NAME
    if (infile == -1) {
        response_length
            = sprintf(response, "HTTP/1.1 404 Not Found\r\nContent-Length: 10 \r\n\r\nNot Found\n");
        write_n_bytes(fd, response, response_length);
        fprintf(stderr, "GET,/%s,404,%d\n", file_name, request_id);
    }

    //CHECK IF FILE IS DIRECTORY
    else if (S_ISDIR(file_stat.st_mode)) {
        response_length
            = sprintf(response, "HTTP/1.1 403 Forbidden\r\nContent-Length: 10 \r\n\r\nForbidden\n");
        write_n_bytes(fd, response, response_length);
        fprintf(stderr, "GET,/%s,404,%d\n", file_name, request_id);
    }

    //OK
    else {
        off_t total_bytes = lseek(infile, 0, SEEK_END);
        lseek(infile, 0, SEEK_SET);

        response_length
            = sprintf(response, "HTTP/1.1 200 OK\r\nContent-Length: %ld \r\n\r\n", total_bytes);
        write_n_bytes(fd, response, response_length);
        fprintf(stderr, "GET,/%s,200,%d\n", file_name, request_id);

        pass_n_bytes(infile, fd, total_bytes);
    }

    reader_unlock(rw);
}

void process_put(int fd, char *file_name, int request_id, char *content, int content_length) {
    rwlock_t *rw = get_file_lock(file_name);
    writer_lock(rw);

    //CHECK IF FILE WAS CREATED ALREADY
    int outfile = -1;
    bool file_created = false;
    char response[2048];
    int response_length;

    if (access(file_name, F_OK) == 0) {
        outfile = open(file_name, O_WRONLY | O_TRUNC, 0666);
    } else {
        outfile = open(file_name, O_WRONLY | O_CREAT | O_TRUNC, 0666);
        file_created = true;
    }

    if (outfile == -1) {
        response_length = sprintf(response, "HTTP/1.1 500 Internal Server Error\r\nContent-Length: "
                                            "22 \r\n\r\nInternal Server Error\n");
        write_n_bytes(fd, response, response_length);
        fprintf(stderr, "PUT,/%s,500,%d\n", file_name, request_id);
    }

    else {

        if (file_created) {
            response_length
                = sprintf(response, "HTTP/1.1 201 Created\r\nContent-Length: 8 \r\n\r\nCreated\n");
            write_n_bytes(fd, response, response_length);
            fprintf(stderr, "PUT,/%s,200,%d\n", file_name, request_id);
        } else {
            response_length
                = sprintf(response, "HTTP/1.1 200 OK\r\nContent-Length: 3 \r\n\r\nOK\n");
            write_n_bytes(fd, response, response_length);
            fprintf(stderr, "PUT,/%s,200,%d\n", file_name, request_id);
        }

        int bytes_written = write_n_bytes(outfile, content, strlen(content));
        content_length -= bytes_written;

        char buffer[2048];
        int bytes_read;
        while (content_length > 0 && (bytes_read = read_n_bytes(fd, buffer, sizeof(buffer))) > 0) {
            write_n_bytes(outfile, buffer, bytes_read);
            content_length -= bytes_read;
        }
    }

    writer_unlock(rw);
}

//worker threads (puts connections into queue)
void *worker() {
    while (1) {
        void *connection;
        queue_pop(q, &connection);
        uintptr_t fd = (uintptr_t) connection;

        //READ REQUEST
        char buf[2048];
        int bytes_read = read_until(fd, buf, 500, "\r\n\r\n");
        buf[bytes_read] = '\0';

        //PARSE
        regex_t request;
        regex_t header;
        regmatch_t pmatch[4];
        regmatch_t hmatch[2];

        regcomp(&request, "([a-zA-Z]{1,8}) +(/[a-zA-Z0-9._/]{1,63}) +(HTTP/[0-9].[0-9]+)\r\n",
            REG_EXTENDED);
        regcomp(&header, "[a-zA-Z0-9.-]{1,128}: ([ -~]{1,128})\r\n", REG_EXTENDED);

        char method[8], URI[64], version[9], header_field[256], request_id[128],
            content_length[128];

        if (regexec(&request, buf, 4, pmatch, 0) == 0) {
            int L1 = pmatch[1].rm_eo - pmatch[1].rm_so;
            strncpy(method, &buf[pmatch[1].rm_so], L1);
            method[L1] = '\0';

            int L2 = pmatch[2].rm_eo - pmatch[2].rm_so;
            strncpy(URI, &buf[pmatch[2].rm_so], L2);
            URI[L2] = '\0';

            int L3 = pmatch[3].rm_eo - pmatch[3].rm_so;
            strncpy(version, &buf[pmatch[3].rm_so], L3);
            version[L3] = '\0';
        }

        char *tempbuf = buf;
        while (regexec(&header, tempbuf, 2, hmatch, 0) == 0) {
            int header_length = hmatch[0].rm_eo - hmatch[0].rm_so;
            strncpy(header_field, &tempbuf[hmatch[0].rm_so], header_length);
            if (strstr(header_field, "Request-Id") != NULL) {
                strncpy(request_id, &tempbuf[hmatch[1].rm_so], hmatch[1].rm_eo - hmatch[1].rm_so);
            } else if (strstr(header_field, "Content-Length") != NULL) {
                strncpy(
                    content_length, &tempbuf[hmatch[1].rm_so], hmatch[1].rm_eo - hmatch[1].rm_so);
            }
            tempbuf += hmatch[0].rm_eo;
        }

        char response[128];
        int response_length;

        if (method[0] == '\0') {
            response_length = sprintf(
                response, "HTTP/1.1 400 Bad Request\r\nContent-Length: 12 \r\n\r\nBad Request\n");
            write_n_bytes(fd, response, response_length);
            fprintf(stderr, "%s,/%s,400,%d\n", method, URI + 1, atoi(request_id));
        }

        else if (strcmp(version, "HTTP/1.1") != 0) {
            response_length
                = sprintf(response, "HTTP/1.1 505 Version Not Supported\r\nContent-Length: 22 "
                                    "\r\n\r\nVersion Not Supported\n");
            write_n_bytes(fd, response, response_length);
            fprintf(stderr, "%s,/%s,505,%d\n", method, URI + 1, atoi(request_id));
        }

        else if (strcmp(method, "GET") == 0) {
            process_get(fd, URI + 1, atoi(request_id));
        }

        else if (strcmp(method, "PUT") == 0) {
            process_put(fd, URI + 1, atoi(request_id), tempbuf + 2, atoi(content_length));
        } else {
            response_length = sprintf(response,
                "HTTP/1.1 501 Not Implemented\r\nContent-Length: 16 \r\n\r\nNot Implemented\n");
            write_n_bytes(fd, response, response_length);
            fprintf(stderr, "%s,/%s,501,%d\n", method, URI + 1, atoi(request_id));
        }

        close(fd);
    }
}

int main(int argc, char *argv[]) {
    int opt;
    int n_threads = 4;
    while ((opt = getopt(argc, argv, OPTIONS)) != -1) {
        switch (opt) {
        case 't':
            n_threads = atoi(optarg);
            if (n_threads <= 0) {
                n_threads = 4; //default if invalid thread count
            }
        }
    }

    if (optind >= argc) {
        fprintf(stderr, "ERROR: Please provide a port number\n");
        exit(1);
    }

    int port = atoi(argv[argc - 1]);
    Listener_Socket sock;
    int res = listener_init(&sock, port);
    if (res == -1 || port < 1 || port > 65535) {
        fprintf(stderr, "Invalid Port\n");
        exit(1);
    }

    //init queue
    q = queue_new(n_threads);

    //init file_list
    file_list = NULL;

    //init file_list mutex
    pthread_mutex_init(&file_mutex, NULL);

    //worker threads
    pthread_t threads[n_threads];
    for (int i = 0; i < n_threads; i++) {
        pthread_create(&(threads[i]), NULL, worker, NULL);
    }

    //dispatcher thread (listens for new connections)
    while (1) {
        uintptr_t fd = listener_accept(&sock);
        if ((int) fd == -1) {
            printf("Error accepting connection!!!\n");
        } else {
            queue_push(q, (void *) fd);
        }
    }

    for (int i = 0; i < n_threads; i++) {
        pthread_join(threads[i], NULL);
    }

    queue_delete(&q);
    destroy_file_locks();
    pthread_mutex_destroy(&file_mutex);

    exit(0);
}
