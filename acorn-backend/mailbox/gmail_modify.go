package mailbox

import (
	"context"
	"net/url"
)

// AddLabel applies one user label to a message and drops cached copies of that mail.
func (g *Google) AddLabel(ctx context.Context, mailboxID, refreshToken, messageID, labelID string) error {
	g.init()
	access, err := g.accessToken(ctx, refreshToken)
	if err != nil {
		return err
	}
	_, err = g.post(ctx, access, "/messages/"+url.PathEscape(messageID)+"/modify", map[string][]string{
		"addLabelIds": {labelID},
	})
	if err != nil {
		return err
	}
	key := mailboxID + "\x00" + messageID
	g.rows.delete(key)
	g.messages.delete(key)
	g.pages.deletePrefix(mailboxID + "\x00")
	g.labels.delete(mailboxID)
	return nil
}
