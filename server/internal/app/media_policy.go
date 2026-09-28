package app

import "github.com/livekit/protocol/livekit"

func (s *Server) validMediaSources(p *livekit.ParticipantInfo) bool {
	counts := map[livekit.TrackSource]int{}
	for _, track := range p.Tracks {
		counts[track.Source]++
		if counts[track.Source] > 1 {
			return false
		}
		switch track.Source {
		case livekit.TrackSource_MICROPHONE:
		case livekit.TrackSource_SCREEN_SHARE:
			if !s.AllowScreen {
				return false
			}
		default:
			return false
		}
	}
	return true
}
func hasScreen(p *livekit.ParticipantInfo) bool {
	for _, track := range p.Tracks {
		if track.Source == livekit.TrackSource_SCREEN_SHARE {
			return true
		}
	}
	return false
}
