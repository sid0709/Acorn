package httpapi

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/sid0709/acorn/acorn-agent/agent"
)

// startRun opens a run and says its id.
func startRun(t *testing.T, ts string, start agent.Start) string {
	t.Helper()
	response, body := send(t, http.MethodPost, ts+BasePath+"/sessions", start, nil)
	if response.StatusCode != 200 {
		t.Fatalf("start = %d %s", response.StatusCode, body)
	}
	var started agent.Started
	if err := json.Unmarshal(body, &started); err != nil || started.SessionID == "" {
		t.Fatalf("started = %+v %v", started, err)
	}
	return started.SessionID
}

func look(screenshot string) agent.Observation {
	return agent.Observation{Screenshot: screenshot, URL: "https://jobs.example", Viewport: agent.Viewport{Width: 200, Height: 100}}
}

func TestTheStartAndAContinueSayWhatTheTransportCanDo(t *testing.T) {
	_, ts := newServer(t, fakeModel{content: workingReply}, "server-key")
	_, body := send(t, http.MethodPost, ts.URL+BasePath+"/sessions", agent.Start{URL: "https://jobs.example"}, nil)
	var started startedBody
	if err := json.Unmarshal(body, &started); err != nil || !started.Transport.Gzip || !started.Transport.Blobs {
		t.Fatalf("started = %s", body)
	}
	_, body = send(t, http.MethodPost, ts.URL+BasePath+"/sessions/"+started.SessionID+"/continue", nil, nil)
	var continued continuedBody
	if err := json.Unmarshal(body, &continued); err != nil || !continued.Transport.Gzip || !continued.Transport.Blobs {
		t.Fatalf("continued = %s", body)
	}
}

func TestAGzippedRequestIsUnpackedAndALongJSONAnswerIsPackedWhenAccepted(t *testing.T) {
	_, ts := newServer(t, fakeModel{content: workingReply}, "server-key")
	raw, _ := json.Marshal(agent.Start{URL: "https://jobs.example", Trace: true})
	var packed bytes.Buffer
	zipper := gzip.NewWriter(&packed)
	_, _ = zipper.Write(raw)
	_ = zipper.Close()
	request, _ := http.NewRequest(http.MethodPost, ts.URL+BasePath+"/sessions", &packed)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Content-Encoding", "gzip")
	request.Header.Set("Accept-Encoding", "gzip")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		body, _ := io.ReadAll(response.Body)
		t.Fatalf("start = %d %s", response.StatusCode, body)
	}
	// The answer carries the prompt (system.txt), so it is long enough to be packed.
	if response.Header.Get("Content-Encoding") != "gzip" || response.ContentLength <= 0 {
		t.Fatalf("the answer was not packed: %v", response.Header)
	}
	unpacked, err := gzip.NewReader(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(unpacked)
	if err != nil {
		t.Fatal(err)
	}
	var started startedBody
	if err := json.Unmarshal(body, &started); err != nil || started.SessionID == "" || started.Trace == nil {
		t.Fatalf("started = %s %v", body, err)
	}
	if int64(len(body)) <= response.ContentLength {
		t.Fatalf("packing gained nothing: %d on the wire for %d", response.ContentLength, len(body))
	}

	// A short answer is left as it is, and a body that is not gzip is refused plainly.
	response, _ = send(t, http.MethodGet, ts.URL+BasePath+"/health", nil, map[string]string{"Accept-Encoding": "gzip"})
	if response.Header.Get("Content-Encoding") != "" {
		t.Fatalf("a short answer was packed: %v", response.Header)
	}
	response, body = send(t, http.MethodPost, ts.URL+BasePath+"/sessions", agent.Start{URL: "https://jobs.example"}, map[string]string{"Content-Encoding": "gzip"})
	if response.StatusCode != http.StatusBadRequest || !strings.Contains(string(body), "bad_json") {
		t.Fatalf("a body that says gzip and is not = %d %s", response.StatusCode, body)
	}
}

func TestAPictureSentOnceIsSentAgainAsAReference(t *testing.T) {
	_, ts := newServer(t, fakeModel{content: workingReply}, "server-key")
	id := startRun(t, ts.URL, agent.Start{URL: "https://jobs.example"})
	base := ts.URL + BasePath + "/sessions/" + id
	shot := screenshot(t)

	// Sent ahead, the picture is named by its hash, which the extension computes the same way.
	response, body := send(t, http.MethodPost, base+"/blobs", blobsUpload{Images: []string{shot}}, nil)
	var kept blobsKept
	if err := json.Unmarshal(body, &kept); response.StatusCode != 200 || err != nil || len(kept.Hashes) != 1 || kept.Hashes[0] != blobHash(shot) {
		t.Fatalf("blobs = %d %s", response.StatusCode, body)
	}
	// The look refers to it, and the agent sees the picture: the step goes through.
	response, body = send(t, http.MethodPost, base+"/step", look(blobRef(kept.Hashes[0])), nil)
	if response.StatusCode != 200 || !strings.Contains(string(body), `"working"`) {
		t.Fatalf("a step by reference = %d %s", response.StatusCode, body)
	}
	// A reference to a picture never sent names what is missing, so the extension can send it as bytes.
	never := strings.Repeat("f", 64)
	response, body = send(t, http.MethodPost, base+"/step", look(blobRef(never)), nil)
	var failure errorBody
	if err := json.Unmarshal(body, &failure); response.StatusCode != http.StatusUnprocessableEntity || err != nil || failure.Code != codeMissingBlobs || len(failure.Missing) != 1 || failure.Missing[0] != never {
		t.Fatalf("a step by an unknown reference = %d %s", response.StatusCode, body)
	}
	// The same picture in two fields of one look is sent once.
	obs := look(shot)
	obs.ZoneShots = []agent.ZoneShot{{Zone: 1, Screenshot: blobRef(blobHash(shot)), ScrollY: 0}}
	if response, body = send(t, http.MethodPost, base+"/step", obs, nil); response.StatusCode != 200 {
		t.Fatalf("a look that refers to its own picture = %d %s", response.StatusCode, body)
	}
	// Pictures are the run's own: another run cannot refer to them, and they go with the run.
	other := startRun(t, ts.URL, agent.Start{URL: "https://jobs.example"})
	if response, _ = send(t, http.MethodPost, ts.URL+BasePath+"/sessions/"+other+"/step", look(blobRef(blobHash(shot))), nil); response.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("another run saw this run's picture: %d", response.StatusCode)
	}
	send(t, http.MethodDelete, base, nil, nil)
	if response, _ = send(t, http.MethodPost, base+"/blobs", blobsUpload{Images: []string{shot}}, nil); response.StatusCode != http.StatusNotFound {
		t.Fatalf("blobs for an ended run = %d", response.StatusCode)
	}
	if response, body = send(t, http.MethodPost, base+"/blobs", "not an object", nil); response.StatusCode != http.StatusNotFound && response.StatusCode != http.StatusBadRequest {
		t.Fatalf("a body that is not an upload = %d %s", response.StatusCode, body)
	}
}

func TestAShotSentMidBatchIsHeldForTheLookAfterAndALocateShotIsNot(t *testing.T) {
	_, ts := newServer(t, fakeModel{content: workingReply}, "server-key")
	id := startRun(t, ts.URL, agent.Start{URL: "https://jobs.example"})
	base := ts.URL + BasePath + "/sessions/" + id
	shot := screenshot(t)

	response, body := send(t, http.MethodPost, base+"/shots", agent.ShotUpload{Kind: agent.ShotSnap, ID: "s1ch1", Screenshot: shot}, nil)
	if response.StatusCode != 200 || !strings.Contains(string(body), blobHash(shot)) {
		t.Fatalf("a shot = %d %s", response.StatusCode, body)
	}
	if response, body = send(t, http.MethodPost, base+"/step", look(blobRef(blobHash(shot))), nil); response.StatusCode != 200 {
		t.Fatalf("the look after a shot, by reference = %d %s", response.StatusCode, body)
	}

	// A picture sent to find a target is not kept: in a run that never sent it otherwise, a later reference to it is missing.
	second := startRun(t, ts.URL, agent.Start{URL: "https://jobs.example"})
	secondBase := ts.URL + BasePath + "/sessions/" + second
	if response, _ = send(t, http.MethodPost, secondBase+"/locate", agent.LocateRequest{ActionID: "s1a1", Screenshot: shot}, nil); response.StatusCode != 200 {
		t.Fatalf("locate = %d", response.StatusCode)
	}
	if response, _ = send(t, http.MethodPost, secondBase+"/step", look(blobRef(blobHash(shot))), nil); response.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("a locate picture was kept: %d", response.StatusCode)
	}
}

func TestThePreflightAllowsAPackedBodyAndIsKept(t *testing.T) {
	_, ts := newServer(t, fakeModel{content: workingReply}, "server-key")
	response, _ := send(t, http.MethodOptions, ts.URL+BasePath+"/sessions", nil, map[string]string{"Origin": "chrome-extension://abc"})
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("preflight = %d", response.StatusCode)
	}
	allowed := response.Header.Get("Access-Control-Allow-Headers")
	if !strings.Contains(allowed, "Content-Encoding") || response.Header.Get("Access-Control-Max-Age") != preflightMaxAge {
		t.Fatalf("preflight headers: %v", response.Header)
	}
}
