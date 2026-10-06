package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/sid0709/OpenSeat/acorn-backend/profile"
	"github.com/sid0709/OpenSeat/backend-core/config"
	"github.com/sid0709/OpenSeat/backend-core/platform"
)

func main() {
	config.LoadEnvFileAt(".env")
	db, _ := config.LoadDatabase()
	db.DestDB = config.Env("ACORN_DB", "AcornDB")
	ctx := context.Background()
	p, err := platform.Open(ctx, db, platform.Options{})
	if err != nil {
		panic(config.Redact(err, db.MongoURI))
	}
	defer p.Close()
	doc, _, _ := profile.NewStore(p.Mongo(), db.DestDB, nil).Load(ctx, "d0b3da9811f34b329cd3e571096216c8")
	key := doc.OpenrouterApiKey
	system := strings.Repeat("You fill job application forms from an applicant profile. Answer in JSON. ", 120)
	for i := 0; i < 3; i++ {
		body := map[string]any{
			"model": config.OpenRouterModel,
			"messages": []map[string]string{{"role": "system", "content": system}, {"role": "user", "content": fmt.Sprintf("Say {\"n\":%d}", i)}},
			"response_format": map[string]string{"type": "json_object"},
			"reasoning":       map[string]string{"effort": "none"},
			"usage":           map[string]bool{"include": true},
		}
		if len(os.Args) > 1 {
			body["prompt_cache_key"] = "acorn-diag"
		}
		raw, _ := json.Marshal(body)
		req, _ := http.NewRequest("POST", config.OpenRouterBaseURL+"/chat/completions", bytes.NewReader(raw))
		req.Header.Set("Authorization", "Bearer "+key)
		req.Header.Set("Content-Type", "application/json")
		t := time.Now()
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			panic(err)
		}
		out, _ := io.ReadAll(res.Body)
		var parsed struct {
			Provider string          `json:"provider"`
			Usage    json.RawMessage `json:"usage"`
		}
		_ = json.Unmarshal(out, &parsed)
		fmt.Printf("call %d %v provider=%s usage=%s\n", i, time.Since(t), parsed.Provider, parsed.Usage)
	}
}
