package config

import (
	"testing"
)

func TestLoadDatabaseNeedsMongoURI(t *testing.T) {
	t.Setenv("MONGO_URI", "")
	if _, err := LoadDatabase(); err == nil {
		t.Fatal("LoadDatabase without MONGO_URI should fail")
	}
}

func TestLoadDatabaseDefaults(t *testing.T) {
	t.Setenv("MONGO_URI", "mongodb://example")
	t.Setenv("DEST_DB", "")
	t.Setenv("JOBS_COLLECTION", "")
	t.Setenv("COMPANIES_COLLECTION", "")
	db, err := LoadDatabase()
	if err != nil {
		t.Fatal(err)
	}
	if db.DestDB != defaultDestDB || db.JobsCollection != defaultJobsCollection || db.CompaniesCollection != defaultCompaniesCollection {
		t.Fatalf("defaults = %+v", db)
	}
}

func TestLoadErrorReportingOptional(t *testing.T) {
	t.Setenv("SENTRY_DSN", "")
	got := LoadErrorReporting()
	if got.SentryDSN != "" {
		t.Fatalf("empty monitoring = %+v", got)
	}
	t.Setenv("SENTRY_DSN", "  https://dsn.example/1  ")
	got = LoadErrorReporting()
	if got.SentryDSN != "https://dsn.example/1" {
		t.Fatalf("trimmed monitoring = %+v", got)
	}
}
