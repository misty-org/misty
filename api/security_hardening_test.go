package api

import (
	"context"
	"errors"
	"fmt"
	"github.com/kannachi323/misty/server/db"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// These lock in the protections that stand between an abusive caller and a
// provider bill. Each one failed before the hardening pass.

func hardeningHandler(limiter *APIRateLimiter) http.Handler {
	return limiter.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
}

func TestForwardedHeaderCannotForgeARateLimitKey(t *testing.T) {
	t.Setenv("TRUST_PROXY_HEADERS", "true")
	ResetTrustedProxyCacheForTest()
	t.Cleanup(ResetTrustedProxyCacheForTest)

	handler := hardeningHandler(NewAPIRateLimiter())
	allowed := 0
	for i := 0; i < 200; i++ {
		request := httptest.NewRequest(http.MethodPost, "/login", nil)
		request.RemoteAddr = "10.0.0.9:1234"
		// nginx's $proxy_add_x_forwarded_for appends the real peer, so the
		// attacker's value sits to the left and must be ignored.
		request.Header.Set("X-Forwarded-For", fmt.Sprintf("1.2.3.%d, 203.0.113.7", i%256))
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		if recorder.Code == http.StatusOK {
			allowed++
		}
	}
	if allowed > 20 {
		t.Fatalf("forged X-Forwarded-For allowed %d requests past a 20/min limit", allowed)
	}
}

func TestForwardedHeaderIgnoredFromUntrustedPeer(t *testing.T) {
	t.Setenv("TRUST_PROXY_HEADERS", "true")
	ResetTrustedProxyCacheForTest()
	t.Cleanup(ResetTrustedProxyCacheForTest)

	// A direct connection from the public internet may not claim a chain, even
	// when proxy trust is switched on.
	request := httptest.NewRequest(http.MethodPost, "/login", nil)
	request.RemoteAddr = "198.51.100.4:9999"
	request.Header.Set("X-Forwarded-For", "1.2.3.4")
	if got := clientIPFromRequest(request); got != "198.51.100.4" {
		t.Fatalf("clientIPFromRequest() = %q, want the untrusted peer's own address", got)
	}
}

func TestForwardedChainSkipsTrustedHops(t *testing.T) {
	t.Setenv("TRUST_PROXY_HEADERS", "true")
	ResetTrustedProxyCacheForTest()
	t.Cleanup(ResetTrustedProxyCacheForTest)

	request := httptest.NewRequest(http.MethodPost, "/login", nil)
	request.RemoteAddr = "10.0.0.9:1234"
	request.Header.Set("X-Forwarded-For", "1.2.3.4, 203.0.113.7, 10.0.0.9")
	if got := clientIPFromRequest(request); got != "203.0.113.7" {
		t.Fatalf("clientIPFromRequest() = %q, want the right-most untrusted hop", got)
	}
}

func TestConfiguredProxyCIDRIsTrusted(t *testing.T) {
	t.Setenv("TRUST_PROXY_HEADERS", "true")
	t.Setenv("TRUSTED_PROXY_CIDRS", "198.51.100.0/24")
	ResetTrustedProxyCacheForTest()
	t.Cleanup(ResetTrustedProxyCacheForTest)

	request := httptest.NewRequest(http.MethodPost, "/login", nil)
	request.RemoteAddr = "198.51.100.4:9999"
	request.Header.Set("X-Forwarded-For", "203.0.113.7")
	if got := clientIPFromRequest(request); got != "203.0.113.7" {
		t.Fatalf("clientIPFromRequest() = %q, want the client behind a configured proxy", got)
	}
}

func TestLimiterStateStaysBounded(t *testing.T) {
	limiter := NewAPIRateLimiter()
	handler := hardeningHandler(limiter)
	for i := 0; i < 5000; i++ {
		request := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/invented-%d", i), nil)
		request.RemoteAddr = "203.0.113.7:1234"
		handler.ServeHTTP(httptest.NewRecorder(), request)
	}
	limiter.mu.Lock()
	tracked := len(limiter.limiters)
	limiter.mu.Unlock()
	if tracked > maxTrackedRoutes+1 {
		t.Fatalf("retained %d limiters, want at most %d", tracked, maxTrackedRoutes+1)
	}
}

func TestLimiterCallerStateStaysBounded(t *testing.T) {
	limiter := NewSlidingWindowLimiter(5, time.Minute)
	limiter.maxKeys = 100
	now := time.Now()
	for i := 0; i < 5000; i++ {
		limiter.Allow(fmt.Sprintf("caller-%d", i), now)
	}
	if tracked := limiter.TrackedKeys(); tracked > 100 {
		t.Fatalf("tracked %d callers, want the cap of 100 to hold", tracked)
	}
}

func TestExpiredCallersArePurgedSoLegitimateTrafficStillFlows(t *testing.T) {
	limiter := NewSlidingWindowLimiter(5, time.Minute)
	limiter.maxKeys = 50
	start := time.Now()
	for i := 0; i < 50; i++ {
		limiter.Allow(fmt.Sprintf("old-%d", i), start)
	}
	// Once the old window has elapsed those entries are dead weight; a new
	// caller must not be refused because a past spray filled the table.
	later := start.Add(2 * time.Minute)
	if allowed, _ := limiter.Allow("fresh-caller", later); !allowed {
		t.Fatal("a new caller was refused after the old window expired")
	}
}

func TestSpaceRoutesShareOneBudgetPerRouteShape(t *testing.T) {
	limiter := NewAPIRateLimiter()
	handler := hardeningHandler(limiter)

	allowed := 0
	for i := 0; i < 100; i++ {
		// A different Space each time must not mint a fresh sync budget: the
		// upstream Google/Discord cost is per call, not per Space.
		path := fmt.Sprintf("/spaces/space_%036d/calendar/sync", i)
		request := httptest.NewRequest(http.MethodPost, path, nil)
		request.RemoteAddr = "203.0.113.7:1234"
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		if recorder.Code == http.StatusOK {
			allowed++
		}
	}
	if allowed > 6 {
		t.Fatalf("calendar sync allowed %d calls across Spaces, want the 6/min budget", allowed)
	}
}

func TestProviderRoutesNormalizeToTheirPolicy(t *testing.T) {
	cases := map[string]string{
		"/api/spaces/space_abcdefabcdefabcdef/calendar/sync":                                       "/spaces/{spaceID}/calendar/sync",
		"/spaces/space_abcdefabcdefabcdef/integrations/discord/link":                               "/spaces/{spaceID}/integrations/discord/link",
		"/spaces/space_abcdefabcdefabcdef/integrations/discord/link/discordlink_x1x2x3x4x5x6/sync": "/spaces/{spaceID}/integrations/discord/link/{id}/sync",
		"/spaces/space_abcdefabcdefabcdef/integrations/notion/search":                              "/spaces/{spaceID}/integrations/notion/search",
		"/spaces/space_abcdefabcdefabcdef/integrations/discord/authorize":                          "/spaces/{spaceID}/integrations/{provider}/authorize",
		"/spaces/space_abcdefabcdefabcdef/tasks/calendar":                                          "/spaces/{spaceID}/tasks/calendar",
	}
	for input, want := range cases {
		if got := normalizeRateLimitPath(input); got != want {
			t.Fatalf("normalizeRateLimitPath(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestAbuseGuardBlocksSustainedAbuse(t *testing.T) {
	policy := AbusePolicy{
		TotalLimit: 5, TotalWindow: time.Minute,
		StrikesBeforeBlock: 3, StrikeWindow: time.Minute,
		BaseBlock: time.Minute, MaxBlock: 10 * time.Minute,
	}
	guard := NewAbuseGuard(policy)
	handler := guard.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	statuses := map[int]int{}
	for i := 0; i < 30; i++ {
		request := httptest.NewRequest(http.MethodGet, "/spaces", nil)
		request.RemoteAddr = "203.0.113.7:1234"
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		statuses[recorder.Code]++
	}
	if statuses[http.StatusOK] > policy.TotalLimit {
		t.Fatalf("total ceiling let %d requests through, want %d", statuses[http.StatusOK], policy.TotalLimit)
	}
	if blocked, _ := guard.Blocked("203.0.113.7"); !blocked {
		t.Fatal("sustained rejections should have escalated to a block")
	}
}

func TestAbuseGuardDoesNotBlockAnIsolatedBurst(t *testing.T) {
	policy := DefaultAbusePolicy()
	guard := NewAbuseGuard(policy)
	// A handful of rejections is a client misbehaving briefly, not an attack.
	for i := 0; i < policy.StrikesBeforeBlock-1; i++ {
		guard.RecordRejection("203.0.113.7")
	}
	if blocked, _ := guard.Blocked("203.0.113.7"); blocked {
		t.Fatal("an isolated burst must not be blocked")
	}
}

func TestAbuseGuardBlockEscalatesThenRecovers(t *testing.T) {
	policy := AbusePolicy{
		TotalLimit: 100, TotalWindow: time.Minute,
		StrikesBeforeBlock: 2, StrikeWindow: time.Minute,
		BaseBlock: time.Minute, MaxBlock: 4 * time.Minute,
	}
	guard := NewAbuseGuard(policy)
	current := time.Now()
	guard.now = func() time.Time { return current }

	guard.RecordRejection("bad")
	guard.RecordRejection("bad")
	blocked, first := guard.Blocked("bad")
	if !blocked || first > time.Minute {
		t.Fatalf("first block = %v, want the one minute base", first)
	}

	// Re-offending after the block expires costs longer each time.
	current = current.Add(2 * time.Minute)
	guard.RecordRejection("bad")
	guard.RecordRejection("bad")
	if _, second := guard.Blocked("bad"); second <= time.Minute {
		t.Fatalf("second block = %v, want escalation beyond the base", second)
	}

	// And a caller that stops offending is eventually forgiven.
	current = current.Add(10 * time.Minute)
	if blocked, _ := guard.Blocked("bad"); blocked {
		t.Fatal("block should have expired")
	}
}

func TestAbuseGuardStateStaysBounded(t *testing.T) {
	guard := NewAbuseGuard(DefaultAbusePolicy())
	guard.maxKeys = 200
	for i := 0; i < 5000; i++ {
		guard.RecordRejection(fmt.Sprintf("caller-%d", i))
	}
	if tracked := guard.TrackedKeys(); tracked > 200 {
		t.Fatalf("tracked %d callers, want the cap of 200 to hold", tracked)
	}
}

func TestCostRoutesAreChargedPerAccountNotPerAddress(t *testing.T) {
	limiter := NewAPIRateLimiter()
	handler := hardeningHandler(limiter)

	allowed := 0
	for i := 0; i < 200; i++ {
		// One stolen credential, replayed from 200 different addresses — the
		// botnet case that per-IP limiting cannot see.
		request := httptest.NewRequest(http.MethodPost, "/ai/complete", nil)
		request.RemoteAddr = fmt.Sprintf("203.0.113.%d:1234", i%256)
		request.Header.Set("Authorization", "Bearer stolen-session-token")
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		if recorder.Code == http.StatusOK {
			allowed++
		}
	}
	if allowed > 12 {
		t.Fatalf("one credential across many IPs got %d AI calls, want the 12/min account budget", allowed)
	}
}

func TestDistinctAccountsKeepIndependentBudgets(t *testing.T) {
	limiter := NewAPIRateLimiter()
	handler := hardeningHandler(limiter)

	call := func(token string) int {
		request := httptest.NewRequest(http.MethodPost, "/ai/complete", nil)
		request.RemoteAddr = "203.0.113.7:1234"
		request.Header.Set("Authorization", "Bearer "+token)
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		return recorder.Code
	}
	for i := 0; i < 12; i++ {
		call("account-one")
	}
	// A second account sharing the same NAT address must not inherit the first
	// account's exhausted budget.
	if code := call("account-two"); code != http.StatusOK {
		t.Fatalf("second account behind the same address got %d, want 200", code)
	}
}

func TestUnauthenticatedTrafficStillKeysOnAddress(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/ai/complete", nil)
	request.RemoteAddr = "203.0.113.7:1234"
	if got := rateLimitIdentity(request); got != "ip:203.0.113.7" {
		t.Fatalf("rateLimitIdentity() = %q, want the address for anonymous traffic", got)
	}
}

func TestIdentityKeyDoesNotLeakTheCredential(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/ai/complete", nil)
	request.Header.Set("Authorization", "Bearer super-secret-session-token")
	key := rateLimitIdentity(request)
	if strings.Contains(key, "super-secret-session-token") {
		t.Fatalf("identity key %q embeds the raw credential", key)
	}
	if !identityIsAccount(key) {
		t.Fatalf("identity key %q should be account-scoped", key)
	}
}

func TestBearerAndCookieCredentialsAreBothRecognised(t *testing.T) {
	bearer := httptest.NewRequest(http.MethodPost, "/ai/complete", nil)
	bearer.Header.Set("Authorization", "Bearer token-value")

	cookie := httptest.NewRequest(http.MethodPost, "/ai/complete", nil)
	cookie.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "token-value"})

	// The same session presented either way must land in the same bucket,
	// otherwise switching transport doubles the budget.
	if rateLimitIdentity(bearer) != rateLimitIdentity(cookie) {
		t.Fatal("bearer and cookie forms of one session produced different keys")
	}
}

// fakeBlockStore stands in for the database so the restart path can be tested
// without one.
type fakeBlockStore struct {
	mu     sync.Mutex
	blocks map[string]db.AbuseBlock
	fail   bool
}

func newFakeBlockStore() *fakeBlockStore {
	return &fakeBlockStore{blocks: map[string]db.AbuseBlock{}}
}

func (s *fakeBlockStore) SaveAbuseBlock(_ context.Context, block db.AbuseBlock) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, ok := s.blocks[block.Key]; ok && existing.BlockSeconds > block.BlockSeconds {
		return nil
	}
	s.blocks[block.Key] = block
	return nil
}

func (s *fakeBlockStore) ActiveAbuseBlocks(context.Context) ([]db.AbuseBlock, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.fail {
		return nil, errors.New("database unavailable")
	}
	out := []db.AbuseBlock{}
	for _, block := range s.blocks {
		if block.BlockedUntil.After(time.Now()) {
			out = append(out, block)
		}
	}
	return out, nil
}

func (s *fakeBlockStore) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.blocks)
}

func TestBlocksSurviveARestart(t *testing.T) {
	store := newFakeBlockStore()
	policy := AbusePolicy{
		TotalLimit: 100, TotalWindow: time.Minute,
		StrikesBeforeBlock: 2, StrikeWindow: time.Minute,
		BaseBlock: 10 * time.Minute, MaxBlock: time.Hour,
	}

	first := NewAbuseGuard(policy).WithStore(context.Background(), store)
	first.RecordRejection("ip:203.0.113.7")
	first.RecordRejection("ip:203.0.113.7")
	if blocked, _ := first.Blocked("ip:203.0.113.7"); !blocked {
		t.Fatal("caller should be blocked before the restart")
	}
	// The write is asynchronous so a storage stall never delays a request.
	deadline := time.Now().Add(2 * time.Second)
	for store.count() == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}

	// A new process must not forgive the block simply because it restarted.
	second := NewAbuseGuard(policy).WithStore(context.Background(), store)
	if blocked, _ := second.Blocked("ip:203.0.113.7"); !blocked {
		t.Fatal("a restarted instance forgave an active block")
	}
}

func TestRefreshPropagatesBlocksBetweenInstances(t *testing.T) {
	store := newFakeBlockStore()
	policy := DefaultAbusePolicy()
	instanceB := NewAbuseGuard(policy).WithStore(context.Background(), store)

	// Another instance blocks a caller directly in shared storage.
	_ = store.SaveAbuseBlock(context.Background(), db.AbuseBlock{
		Key: "acct:abusive", BlockedUntil: time.Now().Add(15 * time.Minute), BlockSeconds: 900,
	})
	if blocked, _ := instanceB.Blocked("acct:abusive"); blocked {
		t.Fatal("instance B should not know about the block before refreshing")
	}
	instanceB.Refresh(context.Background())
	if blocked, _ := instanceB.Blocked("acct:abusive"); !blocked {
		t.Fatal("a block raised by another instance did not propagate")
	}
}

func TestRefreshFailureKeepsExistingBlocks(t *testing.T) {
	store := newFakeBlockStore()
	policy := AbusePolicy{
		TotalLimit: 100, TotalWindow: time.Minute,
		StrikesBeforeBlock: 1, StrikeWindow: time.Minute,
		BaseBlock: 10 * time.Minute, MaxBlock: time.Hour,
	}
	guard := NewAbuseGuard(policy).WithStore(context.Background(), store)
	guard.RecordRejection("ip:203.0.113.7")

	// A database blip must not silently unblock everyone.
	store.mu.Lock()
	store.fail = true
	store.mu.Unlock()
	guard.Refresh(context.Background())

	if blocked, _ := guard.Blocked("ip:203.0.113.7"); !blocked {
		t.Fatal("a failed refresh dropped an in-memory block")
	}
}

func TestGuardWithoutAStoreStillWorks(t *testing.T) {
	// Single-node runs and tests pass nil; the guard must stay fully functional.
	guard := NewAbuseGuard(DefaultAbusePolicy()).WithStore(context.Background(), nil)
	guard.Refresh(context.Background())
	if blocked, _ := guard.Blocked("ip:203.0.113.7"); blocked {
		t.Fatal("unexpected block")
	}
}
