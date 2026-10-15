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
<form id="form" novalidate>
  <h1>Data Engineer: Application</h1>
  <label for="name">Full name</label>
  <input id="name" name="name" type="text" autocomplete="off">
  <label for="email">Email</label>
  <input id="email" name="email" type="email" autocomplete="off">
  <label for="auth">Are you authorized to work in the United States?</label>
  <select id="auth" name="auth">
    <option value="">Select…</option>
    <option value="yes">Yes</option>
    <option value="no">No</option>
  </select>
  <label><input id="agree" type="checkbox"> I agree to the privacy policy</label>
  <label>Résumé</label>
  <button id="upload" type="button">Attach résumé</button>
  <input id="file" type="file" hidden>
  <span id="fileName"></span>
  <p><button id="submit" type="submit">Submit application</button></p>
  <p id="problem" class="error" hidden></p>
</form>
<div id="done" hidden><h1>Thanks, your application was received.</h1></div>
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

export function startAgentSite() {
  return Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response(SITE_HTML, { headers: { "Content-Type": "text/html" } }),
  });
}
