// SPDX-License-Identifier: MIT
// Deliberately fragments frames so the client must read exactly each field.
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
int main(int argc, char **argv) {
    if (argc != 3 || strcmp(argv[2], "native-fixture@misty.test")) return 2;
    uint32_t length;
    while (fread(&length, 4, 1, stdin) == 1) {
        if (length > 1024 * 1024) return 3;
        char *body = calloc(length + 1, 1);
        if (!body || fread(body, 1, length, stdin) != length) return 4;
        if (!strcmp(body, "\"oversize\"")) {
            length = 1024 * 1024 + 1;
            fwrite(&length, 4, 1, stdout); fflush(stdout); free(body);
            sleep(10); return 5;
        }
        fwrite(&length, 1, 1, stdout); fflush(stdout); usleep(1000);
        fwrite(((char *)&length) + 1, 1, 3, stdout); fflush(stdout);
        fwrite(body, 1, length / 2, stdout); fflush(stdout); usleep(1000);
        fwrite(body + length / 2, 1, length - length / 2, stdout); fflush(stdout);
        free(body);
    }
    return 0;
}
