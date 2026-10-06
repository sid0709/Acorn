// Package profile stores the account profile the website edits and Fill reads.
package profile

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const profilesCollection = "acorn_profiles"

const (
	maxName        = 120
	maxContact     = 200
	maxSecret      = 200
	maxSummary     = 2000
	maxTimeline    = 24
	maxResume      = 8 << 20
	minResumeRunes = 40
)

var (
	// ErrInvalid is a profile or résumé Acorn will not store.
	ErrInvalid = errors.New("invalid profile")
	// ErrUnreadable is a résumé file with no usable text.
	ErrUnreadable = errors.New("couldn't read text from that file")
)

// Entry is one role or school on the profile timeline.
type Entry struct {
	ID         string `json:"id" bson:"id"`
	Kind       string `json:"kind" bson:"kind"`
	Title      string `json:"title" bson:"title"`
	Org        string `json:"org" bson:"org"`
	Summary    string `json:"summary" bson:"summary"`
	StartMonth string `json:"startMonth" bson:"startMonth"`
	StartYear  string `json:"startYear" bson:"startYear"`
	EndMonth   string `json:"endMonth" bson:"endMonth"`
	EndYear    string `json:"endYear" bson:"endYear"`
	Current    bool   `json:"current" bson:"current"`
}

// Document is the profile form. Passwords and API keys stay here for the
// signed-in account and are never copied into the planner prompt.
type Document struct {
	FullName               string  `json:"fullName" bson:"fullName"`
	FirstName              string  `json:"firstName" bson:"firstName"`
	MiddleName             string  `json:"middleName" bson:"middleName"`
	LastName               string  `json:"lastName" bson:"lastName"`
	Age                    string  `json:"age" bson:"age"`
	Gender                 string  `json:"gender" bson:"gender"`
	Pronouns               string  `json:"pronouns" bson:"pronouns"`
	Orientation            string  `json:"orientation" bson:"orientation"`
	Email                  string  `json:"email" bson:"email"`
	Phone                  string  `json:"phone" bson:"phone"`
	GmailAppPassword       string  `json:"gmailAppPassword" bson:"gmailAppPassword"`
	Street                 string  `json:"street" bson:"street"`
	City                   string  `json:"city" bson:"city"`
	State                  string  `json:"state" bson:"state"`
	Citizenship            string  `json:"citizenship" bson:"citizenship"`
	Country                string  `json:"country" bson:"country"`
	Zip                    string  `json:"zip" bson:"zip"`
	Linkedin               string  `json:"linkedin" bson:"linkedin"`
	Github                 string  `json:"github" bson:"github"`
	Portfolio              string  `json:"portfolio" bson:"portfolio"`
	HispanicLatino         string  `json:"hispanicLatino" bson:"hispanicLatino"`
	RaceEthnicity          string  `json:"raceEthnicity" bson:"raceEthnicity"`
	VisaSponsorship        string  `json:"visaSponsorship" bson:"visaSponsorship"`
	WorkAuthorized         string  `json:"workAuthorized" bson:"workAuthorized"`
	PublicTrust            string  `json:"publicTrust" bson:"publicTrust"`
	SecurityClearance      string  `json:"securityClearance" bson:"securityClearance"`
	Over18                 string  `json:"over18" bson:"over18"`
	BackgroundCheck        string  `json:"backgroundCheck" bson:"backgroundCheck"`
	WillingToRelocate      string  `json:"willingToRelocate" bson:"willingToRelocate"`
	WorkModePreference     string  `json:"workModePreference" bson:"workModePreference"`
	WillingToTravel        string  `json:"willingToTravel" bson:"willingToTravel"`
	NoticePeriod           string  `json:"noticePeriod" bson:"noticePeriod"`
	Disability             string  `json:"disability" bson:"disability"`
	VeteranStatus          string  `json:"veteranStatus" bson:"veteranStatus"`
	DesiredSalary          string  `json:"desiredSalary" bson:"desiredSalary"`
	OpenaiApiKey           string  `json:"openaiApiKey" bson:"openaiApiKey"`
	DeepseekApiKey         string  `json:"deepseekApiKey" bson:"deepseekApiKey"`
	DefaultAccountPassword string  `json:"defaultAccountPassword" bson:"defaultAccountPassword"`
	ResumeFolderPath       string  `json:"resumeFolderPath" bson:"resumeFolderPath"`
	ModelProvider          string  `json:"modelProvider" bson:"modelProvider"`
	ModelName              string  `json:"modelName" bson:"modelName"`
	Timeline               []Entry `json:"timeline" bson:"timeline"`
}

type storedProfile struct {
	AccountID string    `bson:"accountId"`
	Profile   Document  `bson:"profile"`
	UpdatedAt time.Time `bson:"updatedAt"`
}

// Store keeps one profile per account. Memory is the copy this process reads;
// Mongo is filled when a client is configured.
type Store struct {
	mu   sync.Mutex
	rows map[string]Document
	coll *mongo.Collection
}

func NewMemory() *Store {
	return &Store{rows: map[string]Document{}}
}

func NewStore(client *mongo.Client, database string) *Store {
	store := NewMemory()
	if client != nil && database != "" {
		store.coll = client.Database(database).Collection(profilesCollection)
	}
	return store
}

func (s *Store) EnsureIndexes(ctx context.Context) error {
	if s.coll == nil {
		return nil
	}
	_, err := s.coll.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "accountId", Value: 1}},
		Options: options.Index().SetUnique(true),
	})
	return err
}

// Load returns the stored profile. The bool is false when this account has not saved one.
func (s *Store) Load(ctx context.Context, accountID string) (Document, bool, error) {
	s.mu.Lock()
	doc, ok := s.rows[accountID]
	s.mu.Unlock()
	if ok {
		return normalize(doc), true, nil
	}
	if s.coll == nil {
		return Document{}, false, nil
	}
	var row storedProfile
	err := s.coll.FindOne(ctx, bson.D{{Key: "accountId", Value: accountID}}).Decode(&row)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return Document{}, false, nil
	}
	if err != nil {
		return Document{}, false, err
	}
	doc = normalize(row.Profile)
	s.mu.Lock()
	s.rows[accountID] = doc
	s.mu.Unlock()
	return doc, true, nil
}

// Save replaces the account profile.
func (s *Store) Save(ctx context.Context, accountID string, doc Document) (Document, error) {
	doc = normalize(doc)
	if s.coll != nil {
		_, err := s.coll.UpdateOne(ctx,
			bson.D{{Key: "accountId", Value: accountID}},
			bson.D{{Key: "$set", Value: storedProfile{AccountID: accountID, Profile: doc, UpdatedAt: time.Now().UTC()}}},
			options.UpdateOne().SetUpsert(true),
		)
		if err != nil {
			return Document{}, err
		}
	}
	s.mu.Lock()
	s.rows[accountID] = doc
	s.mu.Unlock()
	return doc, nil
}

func normalize(doc Document) Document {
	doc.FullName = clip(doc.FullName, maxName)
	doc.FirstName = clip(doc.FirstName, maxName)
	doc.MiddleName = clip(doc.MiddleName, maxName)
	doc.LastName = clip(doc.LastName, maxName)
	doc.Age = clip(doc.Age, 3)
	doc.Gender = clip(doc.Gender, maxContact)
	doc.Pronouns = clip(doc.Pronouns, maxContact)
	doc.Orientation = clip(doc.Orientation, maxContact)
	doc.Email = clip(doc.Email, maxContact)
	doc.Phone = clip(doc.Phone, maxContact)
	doc.GmailAppPassword = clip(doc.GmailAppPassword, maxSecret)
	doc.Street = clip(doc.Street, maxContact)
	doc.City = clip(doc.City, maxContact)
	doc.State = clip(doc.State, maxContact)
	doc.Citizenship = clip(doc.Citizenship, maxContact)
	doc.Country = clip(doc.Country, maxContact)
	doc.Zip = clip(doc.Zip, maxContact)
	doc.Linkedin = clip(doc.Linkedin, maxContact)
	doc.Github = clip(doc.Github, maxContact)
	doc.Portfolio = clip(doc.Portfolio, maxContact)
	doc.HispanicLatino = clip(doc.HispanicLatino, maxContact)
	doc.RaceEthnicity = clip(doc.RaceEthnicity, maxContact)
	doc.VisaSponsorship = clip(doc.VisaSponsorship, maxContact)
	doc.WorkAuthorized = clip(doc.WorkAuthorized, maxContact)
	doc.PublicTrust = clip(doc.PublicTrust, maxContact)
	doc.SecurityClearance = clip(doc.SecurityClearance, maxContact)
	doc.Over18 = clip(doc.Over18, maxContact)
	doc.BackgroundCheck = clip(doc.BackgroundCheck, maxContact)
	doc.WillingToRelocate = clip(doc.WillingToRelocate, maxContact)
	doc.WorkModePreference = clip(doc.WorkModePreference, maxContact)
	doc.WillingToTravel = clip(doc.WillingToTravel, maxContact)
	doc.NoticePeriod = clip(doc.NoticePeriod, maxContact)
	doc.Disability = clip(doc.Disability, maxContact)
	doc.VeteranStatus = clip(doc.VeteranStatus, maxContact)
	doc.DesiredSalary = clip(doc.DesiredSalary, maxContact)
	doc.OpenaiApiKey = clip(doc.OpenaiApiKey, maxSecret)
	doc.DeepseekApiKey = clip(doc.DeepseekApiKey, maxSecret)
	doc.DefaultAccountPassword = clip(doc.DefaultAccountPassword, maxSecret)
	doc.ResumeFolderPath = clip(doc.ResumeFolderPath, maxContact)
	doc.ModelProvider = clip(doc.ModelProvider, maxContact)
	doc.ModelName = clip(doc.ModelName, maxContact)
	if len(doc.Timeline) > maxTimeline {
		doc.Timeline = doc.Timeline[:maxTimeline]
	}
	if doc.Timeline == nil {
		doc.Timeline = []Entry{}
	}
	for i := range doc.Timeline {
		item := &doc.Timeline[i]
		item.ID = clip(item.ID, maxName)
		if item.Kind != "education" {
			item.Kind = "role"
		}
		item.Title = clip(item.Title, maxName)
		item.Org = clip(item.Org, maxName)
		item.Summary = clip(item.Summary, maxSummary)
		item.StartMonth = clip(item.StartMonth, 2)
		item.StartYear = clip(item.StartYear, 4)
		item.EndMonth = clip(item.EndMonth, 2)
		item.EndYear = clip(item.EndYear, 4)
		if item.Current {
			item.EndMonth = ""
			item.EndYear = ""
		}
	}
	return doc
}

func clip(value string, max int) string {
	value = strings.TrimSpace(value)
	if len(value) <= max {
		return value
	}
	return value[:max]
}
