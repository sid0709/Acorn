// A one-page application form with the controls an agent meets: text fields, a native
// list, a checkbox, and a file input behind a styled button. It reports what it received.
export const SITE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Apply: Data Engineer</title>
<style>
  body { font: 16px system-ui, sans-serif; margin: 0; padding: 32px 48px; max-width: 720px; }
  label { display: block; margin: 18px 0 6px; }
  input[type=text], input[type=email], select { width: 420px; padding: 10px; font-size: 16px; }
  button { padding: 10px 18px; font-size: 16px; }
  .error { color: crimson; }
</style>
</head>
<body>
<!--JD-->
<form id="form" novalidate>
  <h1>Data Engineer: Application</h1>
  <label for="name">Full name</label>
  <input id="name" name="name" type="text" autocomplete="off"><!--GAP-->
  <label for="email">Email</label>
  <input id="email" name="email" type="email" autocomplete="off"><!--GAP-->
  <label for="auth">Are you authorized to work in the United States?</label>
  <select id="auth" name="auth">
    <option value="">Select…</option>
    <option value="yes">Yes</option>
    <option value="no">No</option>
  </select><!--GAP-->
  <label><input id="agree" type="checkbox"> I agree to the privacy policy</label><!--GAP-->
  <label>Résumé</label>
  <div class="filebox">
    <button id="upload" type="button">Attach résumé</button><!--CLOUD-->
    <input id="file" type="file" hidden>
  </div>
  <span id="fileName"></span><!--GAP-->
  <p><button id="submit" type="submit">Submit application</button></p>
  <p id="problem" class="error" hidden></p>
</form>
<div id="done" hidden><h1>Thanks, your application was received.</h1></div>
<!--GROW-->
<script>
  const $ = (id) => document.getElementById(id);
  $("upload").addEventListener("click", () => $("file").click());
  $("file").addEventListener("change", () => {
    $("fileName").textContent = $("file").files[0] ? $("file").files[0].name : "";
  });
  $("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const missing = [];
    if (!$("name").value.trim()) missing.push("name");
    if (!$("email").value.includes("@")) missing.push("email");
    if (!$("auth").value) missing.push("work authorization");
    if (!$("agree").checked) missing.push("privacy policy");
    if (!$("file").files.length) missing.push("résumé");
    $("problem").hidden = missing.length === 0;
    $("problem").textContent = "Please complete: " + missing.join(", ");
    if (missing.length) return;
    window.__submitted = {
      name: $("name").value, email: $("email").value, auth: $("auth").value,
      file: $("file").files[0].name, size: $("file").files[0].size,
    };
    $("form").hidden = true;
    $("done").hidden = false;
  });
</script>
</body>
</html>`;

/** A job description, long enough for the agent to judge, wherever the page puts it. */
export const JOB_DESCRIPTION =
  "We are hiring a Data Engineer to build and run our data pipelines in Python. You will design batch and streaming jobs, own their quality, and work with analysts and product teams across the company. Requirements: five years of Python, strong SQL, experience with cloud data warehouses, and a habit of writing tests. We offer remote work, health cover and a learning budget.";

const jdPage = `<!doctype html><html><head><meta charset="utf-8"><title>Job description</title></head><body><h2>Data Engineer</h2><p>${JOB_DESCRIPTION}</p></body></html>`;
const chooserPage = `<!doctype html><html><head><meta charset="utf-8"><title>Dropbox: choose a file</title></head><body><h2>Dropbox</h2><p>Sign in to choose a file from your cloud storage.</p></body></html>`;

/** A site on another host, so its frames are of another origin and process: the job description and a file chooser. */
export function startFrameSite() {
  return Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const html = new URL(req.url).pathname === "/chooser" ? chooserPage : jdPage;
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    },
  });
}

/** Where the job description sits, by `?jd=`, and which file-source trap the page sets, by `?cloud=`. */
function jdMarkup(kind: string, frameOrigin: string): string {
  switch (kind) {
    case "1":
      return `<p id="jd">${JOB_DESCRIPTION}</p>`;
    case "iframe-x":
      return `<iframe src="${frameOrigin}/jd" width="700" height="60" style="border:0"></iframe>`;
    case "iframe-s":
      return `<iframe src="/jd-frame" width="700" height="60" style="border:0"></iframe>`;
    case "shadow-open":
      return `<div id="host"></div><script>document.getElementById("host").attachShadow({mode:"open"}).innerHTML = "<p>${JOB_DESCRIPTION}</p>";</script>`;
    case "shadow-closed":
      return `<job-post></job-post><script>customElements.define("job-post", class extends HTMLElement { constructor() { super(); this.attachShadow({mode:"closed"}).innerHTML = "<p>${JOB_DESCRIPTION}</p>"; } });</script>`;
    default:
      return "";
  }
}

function cloudMarkup(kind: string, frameOrigin: string): string {
  switch (kind) {
    case "dropbox":
      return `<button id="dropbox" type="button" onclick="window.__dropboxClicked = true">Dropbox</button>`;
    case "hidden-frame":
      // A one-pixel frame the page loads for its own scripts: it can show nothing, so it is not judged.
      return `<iframe id="proxy" src="${frameOrigin}/chooser" width="1" height="1" style="position:absolute;left:-9999px"></iframe>`;
    case "popup":
      return `<button id="import" type="button" onclick="window.open('${frameOrigin}/chooser', '_blank')">Import</button>`;
    case "frame":
      return `<button id="import" type="button" onclick="const f = document.createElement('iframe'); f.id = 'chooser'; f.src = '${frameOrigin}/chooser'; f.width = 300; f.height = 120; document.body.appendChild(f);">Import files</button>`;
    default:
      return "";
  }
}

export function startAgentSite(frameOrigin = "http://localhost:0") {
  return Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/jd-frame")
        return new Response(jdPage, { headers: { "Content-Type": "text/html" } });
      // `?tall=1` puts a screen of space between the fields, so each is on a screen of its own;
      // `?grow=1` makes the page 80px taller once the person types in the name field.
      const gap = url.searchParams.has("tall") ? `<div style="height:560px"></div>` : "";
      const grow = url.searchParams.has("grow")
        ? `<script>document.getElementById("name").addEventListener("input", () => { const p = document.createElement("p"); p.style.height = "80px"; p.textContent = "Checking your name…"; document.getElementById("form").prepend(p); }, { once: true });</script>`
        : "";
      const html = SITE_HTML.replaceAll("<!--GAP-->", gap)
        .replace("<!--GROW-->", grow)
        .replace("<!--JD-->", jdMarkup(url.searchParams.get("jd") ?? "", frameOrigin))
        .replace("<!--CLOUD-->", cloudMarkup(url.searchParams.get("cloud") ?? "", frameOrigin));
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    },
  });
}
