package app

// Event is a notification to resynchronize authoritative data, not a durable log.
// IDs are random opaque identifiers; message cursors are independent decimal IDs.
type Event struct {
	Protocol  int    `json:"protocol"`
	ID        string `json:"id"`
	Type      string `json:"type"`
	ChannelID string `json:"channel_id,omitempty"`
}
