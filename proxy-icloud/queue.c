/*
*Author:    Matthew Chen (1940200)
*Program:   queue
*Purpose:   implement a thread safe queue and bounded buffer 
*
*/

#include <stdio.h>
#include <stdlib.h>
#include <pthread.h>
#include <semaphore.h>
#include "queue.h"

typedef struct queue {
    int size;
    void **buffer;
    int in;
    int out;
    sem_t empty;
    sem_t full;
    sem_t mutex;
} queue_t;

queue_t *queue_new(int size) {
    queue_t *q = malloc(sizeof(queue_t));
    q->size = size;
    q->buffer = malloc(sizeof(void *) * size);
    q->in = 0;
    q->out = 0;
    sem_init(&(q->empty), 0, 0);
    sem_init(&(q->full), 0, q->size);
    sem_init(&(q->mutex), 0, 1);

    return q;
}

void queue_delete(queue_t **q) {
    if (*q != NULL && (*q)->buffer != NULL) {
        sem_destroy(&(*q)->empty);
        sem_destroy(&(*q)->full);
        sem_destroy(&(*q)->mutex);
        free((*q)->buffer);
        (*q)->buffer = NULL;
        free(*q);
        *q = NULL;
    }
}

bool queue_push(queue_t *q, void *elem) {
    if (q == NULL) {
        return false;
    }
    sem_wait(&(q->full));
    sem_wait(&(q->mutex));
    q->buffer[q->in] = elem;
    q->in = (q->in + 1) % q->size;
    sem_post(&(q->mutex));
    sem_post(&(q->empty));

    return true;
}

bool queue_pop(queue_t *q, void **elem) {
    if (q == NULL) {
        return false;
    }
    sem_wait(&(q->empty));
    sem_wait(&(q->mutex));
    *elem = q->buffer[q->out];
    q->out = (q->out + 1) % q->size;
    sem_post(&(q->mutex));
    sem_post(&(q->full));

    return true;
}
