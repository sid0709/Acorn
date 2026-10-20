package llm

// BodyStats says what a request body to a model is made of, so a slow send can be read against
// the bytes that were sent. Bytes are those of the text and of the image data URLs as they sit
// in the JSON. The history is every message before the last; the current one is the last.
type BodyStats struct {
	SystemBytes       int `json:"systemBytes"`
	HistoryTextBytes  int `json:"historyTextBytes"`
	CurrentTextBytes  int `json:"currentTextBytes"`
	HistoryImages     int `json:"historyImages"`
	HistoryImageBytes int `json:"historyImageBytes"`
	CurrentImages     int `json:"currentImages"`
	CurrentImageBytes int `json:"currentImageBytes"`
}

// MeasureMessages counts the parts of a chat request's messages.
func MeasureMessages(messages []Message) BodyStats {
	var stats BodyStats
	for i, message := range messages {
		current := i == len(messages)-1
		switch {
		case message.Role == RoleSystem:
			stats.SystemBytes += len(message.Text)
		case current:
			stats.CurrentTextBytes += len(message.Text)
		default:
			stats.HistoryTextBytes += len(message.Text)
		}
		for _, image := range message.Images {
			if current {
				stats.CurrentImages++
				stats.CurrentImageBytes += len(image)
			} else {
				stats.HistoryImages++
				stats.HistoryImageBytes += len(image)
			}
		}
	}
	return stats
}
