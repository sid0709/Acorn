package resume

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

type Store struct {
	mu          sync.Mutex
	configs     map[string]map[string]any
	templates   map[string]UploadedTemplate
	generations map[string]Generation
	library     map[string]LibraryRow
	tasks       map[string]Task
	jobs        map[string]string // accountID+"\x00"+jobID -> resumeID or generationID
	db          *mongo.Database
}

func NewMemory() *Store {
	return &Store{
		configs:     map[string]map[string]any{},
		templates:   map[string]UploadedTemplate{},
		generations: map[string]Generation{},
		library:     map[string]LibraryRow{},
		tasks:       map[string]Task{},
		jobs:        map[string]string{},
	}
}

func NewStore(client *mongo.Client, database string) *Store {
	store := NewMemory()
	if client != nil && database != "" {
		store.db = client.Database(database)
	}
	return store
}

func (s *Store) EnsureIndexes(ctx context.Context) error {
	if s.db == nil {
		return nil
	}
	indexes := []struct {
		coll string
		keys bson.D
	}{
		{templatesCollection, bson.D{{Key: "accountId", Value: 1}}},
		{generationsCollection, bson.D{{Key: "accountId", Value: 1}, {Key: "startedAt", Value: -1}}},
		{libraryCollection, bson.D{{Key: "accountId", Value: 1}, {Key: "uploadedAt", Value: -1}}},
		{tasksCollection, bson.D{{Key: "accountId", Value: 1}}},
		{configsCollection, bson.D{{Key: "accountId", Value: 1}}},
	}
	for _, item := range indexes {
		if _, err := s.db.Collection(item.coll).Indexes().CreateOne(ctx, mongo.IndexModel{Keys: item.keys}); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) config(accountID string) map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	if cfg, ok := s.configs[accountID]; ok {
		return cloneMap(cfg)
	}
	return nil
}

func (s *Store) saveConfig(accountID string, cfg map[string]any) {
	s.mu.Lock()
	s.configs[accountID] = cloneMap(cfg)
	s.mu.Unlock()
	if s.db == nil {
		return
	}
	_, _ = s.db.Collection(configsCollection).UpdateOne(context.Background(),
		bson.D{{Key: "accountId", Value: accountID}},
		bson.D{{Key: "$set", Value: bson.D{{Key: "accountId", Value: accountID}, {Key: "config", Value: cfg}, {Key: "updatedAt", Value: time.Now().UTC()}}}},
		options.UpdateOne().SetUpsert(true),
	)
}

func (s *Store) putTemplate(row UploadedTemplate) {
	s.mu.Lock()
	s.templates[row.ID] = row
	s.mu.Unlock()
	if s.db != nil {
		_, _ = s.db.Collection(templatesCollection).ReplaceOne(context.Background(), bson.D{{Key: "id", Value: row.ID}}, row, options.Replace().SetUpsert(true))
	}
}

func (s *Store) template(accountID, id string) (UploadedTemplate, bool) {
	s.mu.Lock()
	row, ok := s.templates[id]
	s.mu.Unlock()
	if ok && row.AccountID == accountID {
		return row, true
	}
	if s.db == nil {
		return UploadedTemplate{}, false
	}
	var found UploadedTemplate
	err := s.db.Collection(templatesCollection).FindOne(context.Background(), bson.D{{Key: "id", Value: id}, {Key: "accountId", Value: accountID}}).Decode(&found)
	if err != nil {
		return UploadedTemplate{}, false
	}
	s.mu.Lock()
	s.templates[found.ID] = found
	s.mu.Unlock()
	return found, true
}

func (s *Store) listTemplates(accountID string) []UploadedTemplate {
	if rows, ok := loadAccount[UploadedTemplate](s, templatesCollection, accountID, "docx"); ok {
		for i := range rows {
			rows[i].Docx = nil
		}
		return rows
	}
	s.mu.Lock()
	out := make([]UploadedTemplate, 0)
	for _, row := range s.templates {
		if row.AccountID == accountID {
			copy := row
			copy.Docx = nil
			out = append(out, copy)
		}
	}
	s.mu.Unlock()
	return out
}

func (s *Store) deleteTemplate(accountID, id string) bool {
	s.mu.Lock()
	row, ok := s.templates[id]
	if ok && row.AccountID == accountID {
		delete(s.templates, id)
	} else {
		ok = false
	}
	s.mu.Unlock()
	if s.db != nil {
		res, err := s.db.Collection(templatesCollection).DeleteOne(context.Background(), bson.D{{Key: "id", Value: id}, {Key: "accountId", Value: accountID}})
		if err == nil && res.DeletedCount > 0 {
			ok = true
		}
	}
	return ok
}

func (s *Store) putGeneration(row Generation) {
	s.mu.Lock()
	s.generations[row.ID] = row
	s.mu.Unlock()
	if s.db != nil {
		_, _ = s.db.Collection(generationsCollection).ReplaceOne(context.Background(), bson.D{{Key: "id", Value: row.ID}}, row, options.Replace().SetUpsert(true))
	}
}

func (s *Store) generation(accountID, id string) (Generation, bool) {
	s.mu.Lock()
	row, ok := s.generations[id]
	s.mu.Unlock()
	if ok && (accountID == "" || row.AccountID == accountID) {
		return row, true
	}
	if s.db == nil {
		return Generation{}, false
	}
	filter := bson.D{{Key: "id", Value: id}}
	if accountID != "" {
		filter = append(filter, bson.E{Key: "accountId", Value: accountID})
	}
	var found Generation
	if err := s.db.Collection(generationsCollection).FindOne(context.Background(), filter).Decode(&found); err != nil {
		return Generation{}, false
	}
	s.mu.Lock()
	s.generations[found.ID] = found
	s.mu.Unlock()
	return found, true
}

func (s *Store) generationByInput(accountID, inputID string) (Generation, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, row := range s.generations {
		if row.AccountID == accountID && row.InputID == inputID {
			return row, true
		}
	}
	return Generation{}, false
}

func (s *Store) deleteGeneration(accountID, id string) bool {
	s.mu.Lock()
	row, ok := s.generations[id]
	if ok && row.AccountID == accountID {
		delete(s.generations, id)
	} else {
		ok = false
	}
	s.mu.Unlock()
	if s.db != nil {
		res, err := s.db.Collection(generationsCollection).DeleteOne(context.Background(), bson.D{{Key: "id", Value: id}, {Key: "accountId", Value: accountID}})
		if err == nil && res.DeletedCount > 0 {
			ok = true
		}
	}
	return ok
}

func (s *Store) listGenerations(accountID string) []Generation {
	if rows, ok := loadAccount[Generation](s, generationsCollection, accountID, "docx"); ok {
		for i := range rows {
			rows[i].Docx = nil
		}
		return rows
	}
	s.mu.Lock()
	out := make([]Generation, 0)
	for _, row := range s.generations {
		if row.AccountID == accountID {
			out = append(out, row)
		}
	}
	s.mu.Unlock()
	return out
}

func (s *Store) putLibrary(row LibraryRow) error {
	if len(row.Bytes) == 0 {
		s.mu.Lock()
		prev, ok := s.library[row.ID]
		s.mu.Unlock()
		if ok && prev.AccountID == row.AccountID && len(prev.Bytes) > 0 {
			row.Bytes = prev.Bytes
		} else if s.db != nil {
			var existing struct {
				Bytes []byte `bson:"bytes"`
			}
			err := s.db.Collection(libraryCollection).FindOne(
				context.Background(),
				bson.D{{Key: "id", Value: row.ID}},
				options.FindOne().SetProjection(bson.D{{Key: "bytes", Value: 1}}),
			).Decode(&existing)
			if err == nil && len(existing.Bytes) > 0 {
				row.Bytes = existing.Bytes
			}
		}
	}
	s.mu.Lock()
	s.library[row.ID] = row
	s.mu.Unlock()
	if s.db == nil {
		return nil
	}
	_, err := s.db.Collection(libraryCollection).ReplaceOne(context.Background(), bson.D{{Key: "id", Value: row.ID}}, row, options.Replace().SetUpsert(true))
	if err != nil {
		return fmt.Errorf("save library file: %w", err)
	}
	return nil
}

func (s *Store) libraryItem(accountID, id string) (LibraryRow, bool) {
	s.mu.Lock()
	row, ok := s.library[id]
	s.mu.Unlock()
	if ok && row.AccountID == accountID && (s.db == nil || len(row.Bytes) > 0) {
		return row, true
	}
	if s.db == nil {
		return LibraryRow{}, false
	}
	var found LibraryRow
	if err := s.db.Collection(libraryCollection).FindOne(context.Background(), bson.D{{Key: "id", Value: id}, {Key: "accountId", Value: accountID}}).Decode(&found); err != nil {
		return LibraryRow{}, false
	}
	s.mu.Lock()
	s.library[found.ID] = found
	s.mu.Unlock()
	return found, true
}

func (s *Store) hasLibrary(accountID string) bool {
	s.mu.Lock()
	for _, row := range s.library {
		if row.AccountID == accountID {
			s.mu.Unlock()
			return true
		}
	}
	s.mu.Unlock()
	if s.db == nil {
		return false
	}
	err := s.db.Collection(libraryCollection).FindOne(
		context.Background(),
		bson.D{{Key: "accountId", Value: accountID}},
		options.FindOne().SetProjection(bson.D{{Key: "_id", Value: 1}}),
	).Err()
	return err == nil
}

func (s *Store) listLibrary(accountID string) []LibraryRow {
	if rows, ok := loadAccount[LibraryRow](s, libraryCollection, accountID, "bytes"); ok {
		for i := range rows {
			rows[i].Bytes = nil
		}
		return rows
	}
	s.mu.Lock()
	out := make([]LibraryRow, 0)
	for _, row := range s.library {
		if row.AccountID == accountID {
			copy := row
			copy.Bytes = nil
			out = append(out, copy)
		}
	}
	s.mu.Unlock()
	return out
}

// loadAccount reads one account's rows from Mongo. The omitted field is a stored file body.
func loadAccount[T any](s *Store, collection, accountID, omit string) ([]T, bool) {
	if s.db == nil {
		return nil, false
	}
	opts := options.Find()
	if omit != "" {
		opts.SetProjection(bson.D{{Key: omit, Value: 0}})
	}
	cur, err := s.db.Collection(collection).Find(context.Background(), bson.D{{Key: "accountId", Value: accountID}}, opts)
	if err != nil {
		return nil, false
	}
	defer cur.Close(context.Background())
	var rows []T
	if err := cur.All(context.Background(), &rows); err != nil {
		return nil, false
	}
	if rows == nil {
		rows = []T{}
	}
	return rows, true
}

func (s *Store) deleteLibrary(accountID, id string) bool {
	s.mu.Lock()
	row, ok := s.library[id]
	if ok && row.AccountID == accountID {
		delete(s.library, id)
	} else {
		ok = false
	}
	s.mu.Unlock()
	if s.db != nil {
		res, err := s.db.Collection(libraryCollection).DeleteOne(context.Background(), bson.D{{Key: "id", Value: id}, {Key: "accountId", Value: accountID}})
		if err == nil && res.DeletedCount > 0 {
			ok = true
		}
	}
	return ok
}

func (s *Store) putTask(row Task) {
	s.mu.Lock()
	s.tasks[row.ID] = row
	s.mu.Unlock()
	if s.db != nil {
		_, _ = s.db.Collection(tasksCollection).ReplaceOne(context.Background(), bson.D{{Key: "id", Value: row.ID}}, row, options.Replace().SetUpsert(true))
	}
}

func (s *Store) task(accountID, id string) (Task, bool) {
	s.mu.Lock()
	row, ok := s.tasks[id]
	s.mu.Unlock()
	if ok && row.AccountID == accountID {
		return row, true
	}
	return Task{}, false
}

func (s *Store) rememberJob(accountID, jobID, resumeOrGen string) {
	if jobID == "" {
		return
	}
	s.mu.Lock()
	s.jobs[accountID+"\x00"+jobID] = resumeOrGen
	s.mu.Unlock()
}

func (s *Store) jobFile(accountID, jobID string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.jobs[accountID+"\x00"+jobID]
}

// DeleteAccount removes every résumé record this account owns.
func (s *Store) DeleteAccount(ctx context.Context, accountID string) error {
	s.mu.Lock()
	delete(s.configs, accountID)
	for id, row := range s.templates {
		if row.AccountID == accountID {
			delete(s.templates, id)
		}
	}
	for id, row := range s.generations {
		if row.AccountID == accountID {
			delete(s.generations, id)
		}
	}
	for id, row := range s.library {
		if row.AccountID == accountID {
			delete(s.library, id)
		}
	}
	for id, row := range s.tasks {
		if row.AccountID == accountID {
			delete(s.tasks, id)
		}
	}
	prefix := accountID + "\x00"
	for key := range s.jobs {
		if strings.HasPrefix(key, prefix) {
			delete(s.jobs, key)
		}
	}
	s.mu.Unlock()
	if s.db == nil {
		return nil
	}
	filter := bson.D{{Key: "accountId", Value: accountID}}
	for _, name := range []string{
		configsCollection,
		templatesCollection,
		generationsCollection,
		libraryCollection,
		tasksCollection,
	} {
		if _, err := s.db.Collection(name).DeleteMany(ctx, filter); err != nil {
			return fmt.Errorf("delete %s: %w", name, err)
		}
	}
	return nil
}

func cloneMap(in map[string]any) map[string]any {
	if in == nil {
		return nil
	}
	out := make(map[string]any, len(in))
	for key, value := range in {
		out[key] = value
	}
	return out
}

func asString(value any) string {
	text, _ := value.(string)
	return strings.TrimSpace(text)
}
