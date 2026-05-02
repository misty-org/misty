// Package utils provides small reusable primitives shared across proxy
// subsystems. jobs.go contains the in-process job manager used for long-running
// operations that need cancellable execution and progress fan-out.
//
// The job manager is intentionally generic: events carry an opaque Payload so
// callers can stream restic-specific or other subsystem-specific progress
// structs without this package knowing their shape.
package utils

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
)

type State string

const (
	StateRunning   State = "running"
	StateSucceeded State = "succeeded"
	StateFailed    State = "failed"
	StateCancelled State = "cancelled"
)

// Event is one progress emission. Payload is whatever the run function chose
// to attach (e.g. restic.ProgressEvent).
type Event struct {
	Time    time.Time   `json:"time"`
	Payload interface{} `json:"payload,omitempty"`
}

// Job is the public, JSON-friendly view of a tracked operation.
type Job struct {
	ID         string    `json:"id"`
	Type       string    `json:"type"`
	RepoName   string    `json:"repo_name"`
	State      State     `json:"state"`
	StartedAt  time.Time `json:"started_at"`
	FinishedAt time.Time `json:"finished_at,omitempty"`
	Error      string    `json:"error,omitempty"`

	mu     sync.Mutex
	cancel context.CancelFunc
	subs   []chan Event
}

// Manager owns the lifecycle of all jobs in the process.
type Manager struct {
	mu   sync.Mutex
	jobs map[string]*Job
}

func NewManager() *Manager {
	return &Manager{jobs: map[string]*Job{}}
}

// Start spawns a new job. The run function receives a cancellable context
// (Cancel triggers context cancellation) and an emit callback for progress
// events. Returning an error fails the job; returning nil succeeds it.
func (m *Manager) Start(jobType, repoName string, run func(ctx context.Context, emit func(Event)) error) *Job {
	ctx, cancel := context.WithCancel(context.Background())
	job := &Job{
		ID:        uuid.New().String(),
		Type:      jobType,
		RepoName:  repoName,
		State:     StateRunning,
		StartedAt: time.Now(),
		cancel:    cancel,
	}
	m.mu.Lock()
	m.jobs[job.ID] = job
	m.mu.Unlock()

	emit := func(e Event) {
		e.Time = time.Now()
		job.mu.Lock()
		for _, ch := range job.subs {
			// Non-blocking send so a slow subscriber can't stall the runner.
			select {
			case ch <- e:
			default:
			}
		}
		job.mu.Unlock()
	}

	go func() {
		err := run(ctx, emit)
		job.mu.Lock()
		job.FinishedAt = time.Now()
		switch {
		case ctx.Err() != nil:
			job.State = StateCancelled
		case err != nil:
			job.State = StateFailed
			job.Error = err.Error()
		default:
			job.State = StateSucceeded
		}
		// Close all subscriber channels so SSE handlers can detect end-of-stream.
		for _, ch := range job.subs {
			close(ch)
		}
		job.subs = nil
		job.mu.Unlock()
	}()
	return job
}

// Get returns a job by ID.
func (m *Manager) Get(id string) (*Job, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	j, ok := m.jobs[id]
	return j, ok
}

// List returns all jobs the manager currently knows about.
func (m *Manager) List() []*Job {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]*Job, 0, len(m.jobs))
	for _, j := range m.jobs {
		out = append(out, j)
	}
	return out
}

// Subscribe returns a channel that receives subsequent events for the job and
// an unsubscribe function. The channel is closed by the job runner when the
// job ends. If the job has already finished, the returned channel is closed
// immediately so the caller's range loop terminates.
func (m *Manager) Subscribe(id string) (<-chan Event, func(), error) {
	j, ok := m.Get(id)
	if !ok {
		return nil, nil, fmt.Errorf("job not found")
	}
	ch := make(chan Event, 64)
	j.mu.Lock()
	if j.State != StateRunning {
		close(ch)
		j.mu.Unlock()
		return ch, func() {}, nil
	}
	j.subs = append(j.subs, ch)
	j.mu.Unlock()

	unsub := func() {
		j.mu.Lock()
		defer j.mu.Unlock()
		for i, c := range j.subs {
			if c == ch {
				j.subs = append(j.subs[:i], j.subs[i+1:]...)
				break
			}
		}
	}
	return ch, unsub, nil
}

// Cancel signals the job's context to terminate.
func (m *Manager) Cancel(id string) error {
	j, ok := m.Get(id)
	if !ok {
		return fmt.Errorf("job not found")
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.cancel != nil {
		j.cancel()
	}
	return nil
}
