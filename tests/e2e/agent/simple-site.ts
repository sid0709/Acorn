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
      // A page whose only question is a trap for bots, and a continue control that is greyed out for
      // a few seconds after it is pressed, as a page does while it submits.
      if (url.pathname === "/honeypot") {
        return page(
          "Application Questions 2 of 2",
          `<h1>Application Questions 2 of 2</h1>
<p>The core idea is to present a question that is easy for humans but difficult for bots.</p>
<label for="trap">Leave this field blank. If you are human, do not type anything here.</label>
<textarea id="trap" name="trap" rows="3"></textarea>
<div><button type="button" onclick="history.back()">Back</button>
<form id="f" style="display:inline" onsubmit="event.preventDefault();var b=document.getElementById('go');b.disabled=true;setTimeout(function(){location.href='/done'},3500)">
<button id="go" type="submit">Save and Continue</button></form></div>`,
        );
      }
      // A date drawn as two segments: each a transparent input under a display layer that shows its value,
      // so a click lands on the layer and the layer hands focus to the input beneath it.
      if (url.pathname === "/dates") {
        return page(
          "Work experience",
          `<style>.seg{position:relative;display:inline-block;width:70px;height:36px;border:1px solid #888;margin-right:6px}
.seg input{position:absolute;left:0;top:0;width:3px;height:3px;border:0;opacity:0.02;box-sizing:border-box}
.seg .shown{position:absolute;inset:0;display:flex;align-items:center;padding-left:8px}</style>
<h1>Work experience</h1>
<label for="jt">Job title *</label><input type="text" id="jt" name="job_title" required>
<fieldset><legend>From *</legend>
<div class="seg" id="m"><input role="spinbutton" aria-label="Month" id="mi" maxlength="2"><div class="shown" aria-hidden="true">MM</div></div>/
<div class="seg" id="y"><input role="spinbutton" aria-label="Year" id="yi" maxlength="4"><div class="shown" aria-hidden="true">YYYY</div></div></fieldset>
<div id="msg" role="alert"></div>
<form onsubmit="event.preventDefault();var m=+mi.value,y=+yi.value;if(m>=1&&m<=12&&y>=1950){location.href='/done'}else{msg.textContent='Error: Invalid Date'}"><button type="submit">Save and Continue</button></form>
<script>for(const[b,i]of[['m','mi'],['y','yi']]){const box=document.getElementById(b),inp=document.getElementById(i),shown=box.querySelector('.shown');
box.addEventListener('click',()=>inp.focus());inp.addEventListener('input',()=>{shown.textContent=inp.value||(b==='m'?'MM':'YYYY')})}</script>`,
        );
      }
      // Choices that are not native: a list the page draws (a button that opens a listbox), yes/no buttons,
      // a group of radio buttons and a group of checkboxes.
      if (url.pathname === "/choices") {
        return page(
          "Application questions",
          `<style>ul[role=listbox]{list-style:none;margin:4px 0;padding:0;border:1px solid #888;width:260px}ul[role=listbox][hidden]{display:none}
li[role=option]{padding:8px;cursor:pointer}li[aria-selected=true]{background:#cde}
[role=radio]{padding:8px 16px;margin-right:8px}[role=radio][aria-checked=true]{background:#cde}</style>
<h1>Application questions</h1>
<div id="q-degree">What is your highest level of education? *</div>
<button type="button" id="dd" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="q-degree">Select One</button>
<ul role="listbox" id="lb" hidden><li role="option">High school</li><li role="option">Bachelor's degree</li><li role="option">Master's degree</li><li role="option">Doctorate</li></ul>
<div id="q-auth">Are you legally authorized to work in the United States? *</div>
<div role="radiogroup" aria-labelledby="q-auth"><button type="button" role="radio" aria-checked="false">Yes</button><button type="button" role="radio" aria-checked="false">No</button></div>
<fieldset><legend>How did you hear about us? *</legend>
<label><input type="radio" name="src" value="board"> Job board</label>
<label><input type="radio" name="src" value="friend"> Referral</label>
<label><input type="radio" name="src" value="other"> Other</label></fieldset>
<fieldset><legend>Languages you speak (check all that apply)</legend>
<label><input type="checkbox" name="l1"> English</label><label><input type="checkbox" name="l2"> French</label><label><input type="checkbox" name="l3"> Spanish</label></fieldset>
<form onsubmit="event.preventDefault();location.href='/done'"><button type="submit">Save and Continue</button></form>
<script>const dd=document.getElementById('dd'),lb=document.getElementById('lb');
dd.addEventListener('click',()=>{const open=lb.hidden;lb.hidden=!open;dd.setAttribute('aria-expanded',String(open))});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){lb.hidden=true;dd.setAttribute('aria-expanded','false')}});
lb.addEventListener('click',e=>{const li=e.target.closest('li');if(!li)return;lb.querySelectorAll('li').forEach(x=>x.removeAttribute('aria-selected'));li.setAttribute('aria-selected','true');dd.textContent=li.textContent;lb.hidden=true;dd.setAttribute('aria-expanded','false')});
document.querySelectorAll('[role=radio]').forEach(b=>b.addEventListener('click',()=>{b.parentElement.querySelectorAll('[role=radio]').forEach(x=>x.setAttribute('aria-checked','false'));b.setAttribute('aria-checked','true')}))</script>`,
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
    choicesUrl: `http://127.0.0.1:${server.port}/choices`,
    datesUrl: `http://127.0.0.1:${server.port}/dates`,
    honeypotUrl: `http://127.0.0.1:${server.port}/honeypot`,
  };
}
