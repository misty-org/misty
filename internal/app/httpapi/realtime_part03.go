package api

// ViewerSpaceCount reports how many Spaces currently have at least one viewer.
func (s *RealtimeService) ViewerSpaceCount() int {
	if s == nil {
		return 0
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.viewers)
}
