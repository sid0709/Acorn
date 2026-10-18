// A small three-page application with plain controls, for running the agent end to end against a
// page that has nothing hard in it: required fields, a native list, a radio group, a textarea,
// a checkbox, a Next button, a Submit button and a confirmation page. Every control is a native one.
export function startSimpleSite() {
  const page = (title: string, body: string) =>
    new Response(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px system-ui;max-width:640px;margin:40px auto;padding:0 16px}label{display:block;margin:14px 0 4px;font-weight:600}
input[type=text],input[type=email],input[type=tel],select,textarea{width:100%;padding:8px;font:inherit;box-sizing:border-box}
button{margin:20px 8px 0 0;padding:10px 18px;font:inherit}fieldset{margin:14px 0;border:1px solid #ccc}</style></head><body>${body}</body></html>`,
      { headers: { "content-type": "text/html" } },
    );
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/submit" && request.method === "POST") {
        return Response.json({ ok: true });
      }
      if (url.pathname === "/done") {
        return page(
          "Application received",
          `<h1>Thank you!</h1><p>Your application was received. We will be in touch.</p>`,
        );
      }
      // A tall page whose submit button, far below the first screen, stays disabled until an agreement
      // box that the page does not mark as required is ticked.
      if (url.pathname === "/gated") {
        return page(
          "Create account",
          `<h1>Create account</h1>
<label for="e">Email *</label><input type="email" id="e" name="email" required>
<label for="p">Password *</label><input type="password" id="p" name="password" required>
<div style="height:1100px"></div>
<label><input type="checkbox" id="agree"> I agree to the privacy policy</label>
<span style="position:relative;display:inline-block"><button id="go" disabled onclick="fetch('/submit',{method:'POST'}).then(()=>location.href='/done')">Create account</button>
<div role="button" id="layer" style="position:absolute;inset:0;opacity:0.01;cursor:pointer" onclick="document.getElementById('go').click()">Create account</div></span>
<script>document.getElementById('agree').addEventListener('change',e=>{document.getElementById('go').disabled=!e.target.checked})</script>`,
        );
      }
      if (url.pathname === "/step2") {
        return page(
          "Apply: questions",
          `<h1>Acme Corp · Software Engineer</h1><h2>Step 2 of 2: Questions</h2>
<form id="f2" action="/done" onsubmit="event.preventDefault();fetch('/submit',{method:'POST'}).then(()=>location.href='/done')">
<fieldset><legend>Are you legally authorized to work in the United States? *</legend>
<label><input type="radio" name="auth" value="yes" required> Yes</label>
<label><input type="radio" name="auth" value="no"> No</label></fieldset>
<label for="country">Country of residence *</label>
<select id="country" name="country" required><option value="">Select…</option><option>Canada</option><option>United States</option><option>United Kingdom</option></select>
<label for="why">Why do you want this job? *</label><textarea id="why" name="why" rows="4" required></textarea>
<label><input type="checkbox" name="news"> Send me job alerts (optional)</label>
<button type="button" onclick="history.back()">Back</button><button type="submit">Submit application</button></form>`,
        );
      }
      return page(
        "Apply: your details",
        `<h1>Acme Corp · Software Engineer</h1><h2>Step 1 of 2: Your details</h2>
<form id="f1" action="/step2">
<label for="fn">First name *</label><input type="text" id="fn" name="first_name" required>
<label for="ln">Last name *</label><input type="text" id="ln" name="last_name" required>
<label for="em">Email *</label><input type="email" id="em" name="email" required>
<label for="ph">Phone</label><input type="tel" id="ph" name="phone">
<button type="submit">Next</button></form>`,
      );
    },
  });
  return {
    server,
    url: `http://127.0.0.1:${server.port}/`,
    gatedUrl: `http://127.0.0.1:${server.port}/gated`,
  };
}
