/**
 * VIGIL AI — auth screens: sign in, create account, forgot & reset password (classic script).
 */
(function (V) {
  const esc = V.UI.esc;
  const roleLabel = V.UI.roleLabel;
  const toast = V.UI.toast;

  const SIDE_POINTS = [
    ["🛡", "Privacy first", "Your wellness data is yours. You decide what is shared, and with whom."],
    ["♡", "Support that reaches out", "Medic Officers, supervisors and trusted buddies — one tap away."],
    ["◉", "Explainable insights", "Recovery and workload indicators you can understand, never diagnoses."],
  ];

  function sidePanel() {
    return (
      '<div class="auth-side" aria-hidden="true">' +
      "<div>" +
      '<div class="eyebrow" style="color:#9DBDB2">Personnel wellness · operational support</div>' +
      '<div class="quote" style="margin-top:14px">Someone is looking out for you.</div>' +
      '<p class="quote-sub">VIGIL AI keeps watch over workload, rest and recovery — so you can focus on the mission, and the people who have your back can stay close.</p>' +
      '<div class="side-points">' +
      SIDE_POINTS.map(function (p) {
        return '<div class="side-point"><div class="p-icon">' + p[0] + "</div>" +
          "<div><strong>" + esc(p[1]) + "</strong><br/><span style=\"color:#AFC9BF; font-size:13.5px\">" + esc(p[2]) + "</span></div></div>";
      }).join("") +
      "</div>" +
      '<p class="demo-note">Demo environment — all data is simulated and stored locally on this device. No external services are contacted.</p>' +
      "</div></div>"
    );
  }

  function shell(formHtml) {
    return '<div class="auth-wrap"><div class="auth-form-col"><div class="form-box">' + formHtml + "</div></div>" + sidePanel() + "</div>";
  }

  function setScreen(html, mount) {
    const root = document.getElementById("auth-root");
    if (!root) return;
    root.innerHTML = shell(html);
    if (mount) mount(root);
  }

  /* ---------- Sign in ---------- */

  function renderLogin(prefill) {
    prefill = prefill || {};
    setScreen(
      '<div class="demo-banner"><span aria-hidden="true">◐</span> Demo mode — sample data, no external services</div>' +
      '<div class="head"><h1 class="display">Welcome back</h1><p>Sign in to your VIGIL AI workspace.</p></div>' +
      '<form id="login-form" novalidate>' +
      '<div class="field"><label for="li-email">Email</label>' +
      '<input id="li-email" name="email" type="email" autocomplete="email" placeholder="you@unit.example" value="' + esc(prefill.email || "") + '" required /></div>' +
      '<div class="field"><label for="li-pass">Password</label>' +
      '<input id="li-pass" name="password" type="password" autocomplete="current-password" placeholder="Your password" required />' +
      '<div class="row-between"><span class="hint">Sessions are private and expire automatically.</span>' +
      '<a href="#/forgot" id="to-forgot">Forgot password?</a></div></div>' +
      '<button class="btn primary lg block" type="submit" id="li-submit">Sign in</button>' +
      '<p class="error-text mt-2 hidden" id="li-error" role="alert"></p></form>' +
      '<div class="alt-auth">New to your unit\'s workspace? <a href="#/register">Create an account</a></div>' +
      '<div id="demo-accounts"></div>',
      function (root) {
        const form = root.querySelector("#login-form");
        const errEl = root.querySelector("#li-error");
        const submit = root.querySelector("#li-submit");

        form.addEventListener("submit", function (e) {
          e.preventDefault();
          errEl.classList.add("hidden");
          const email = form.email.value.trim().toLowerCase();
          const password = form.password.value;
          if (!email || !password) {
            errEl.textContent = "Enter your email and password.";
            errEl.classList.remove("hidden");
            return;
          }
          submit.disabled = true;
          submit.textContent = "Signing in…";
          V.API.auth.login(email, password).then(function () {
            return V.API.endpoints.me();
          }).then(function (me) {
            V.STORE.setUser(me.user);
            V.STORE.setUnread(me.unread_notifications || 0);
            V.STORE.setMeta(me.mode, me.version);
            toast("Welcome back, " + me.user.full_name.split(" ")[0] + ".", "success", "Signed in");
            location.hash = "#/dashboard";
          }).catch(function (err) {
            errEl.textContent = err.message || "Could not sign in.";
            errEl.classList.remove("hidden");
            submit.disabled = false;
            submit.textContent = "Sign in";
          });
        });

        const demoBox = root.querySelector("#demo-accounts");
        V.API.auth.demoAccounts().then(function (res) {
          if (!res.accounts || !res.accounts.length) return;
          let btns = res.accounts.map(function (a) {
            return '<button type="button" class="btn ghost" data-email="' + esc(a.email) + '" data-pass="' + esc(a.password) + '">' +
              esc(roleLabel(a.role).split(" ")[0]) + " · " + esc(a.full_name.split(" ")[0]) + "</button>";
          }).join("");
          demoBox.innerHTML =
            '<div class="mt-6"><div class="eyebrow mb-2">Demo accounts — one-click sign in</div>' +
            '<div class="demo-account-btns">' + btns + "</div></div>";
          demoBox.querySelectorAll("[data-email]").forEach(function (btn) {
            btn.addEventListener("click", function () {
              root.querySelector("#li-email").value = btn.getAttribute("data-email");
              root.querySelector("#li-pass").value = btn.getAttribute("data-pass");
              form.dispatchEvent(new Event("submit", { cancelable: true }));
            });
          });
        }).catch(function () {});
      }
    );
  }

  /* ---------- Register ---------- */

  function pwScore(pw) {
    let s = 0;
    if (pw.length >= 8) s++;
    if (pw.length >= 12 || (/\d/.test(pw) && /[A-Z]/.test(pw))) s++;
    if (/[^A-Za-z0-9]/.test(pw) && pw.length >= 10) s++;
    return s;
  }

  function renderRegister() {
    setScreen(
      '<div class="head"><h1 class="display">Create your account</h1><p>Join your unit\'s VIGIL AI workspace.</p></div>' +
      '<form id="reg-form" novalidate>' +
      '<div class="field"><label for="rg-name">Full name</label><input id="rg-name" name="full_name" placeholder="e.g. Priya Nair" autocomplete="name" required /></div>' +
      '<div class="field"><label for="rg-email">Email</label><input id="rg-email" name="email" type="email" placeholder="you@unit.example" autocomplete="email" required /></div>' +
      '<div class="field"><label for="rg-role">Role</label><select id="rg-role" name="role">' +
      '<option value="personnel">Personnel</option><option value="medic">Medic Officer</option>' +
      '<option value="supervisor">Supervisor</option><option value="admin">Administrator</option></select>' +
      '<span class="hint">In production, roles are approved by administrators.</span></div>' +
      '<div class="field"><label for="rg-pass">Password</label>' +
      '<input id="rg-pass" name="password" type="password" autocomplete="new-password" placeholder="At least 8 characters" required />' +
      '<div class="pw-strength" aria-hidden="true"><div class="bars"><span class="bar"></span><span class="bar"></span><span class="bar"></span></div>' +
      '<span class="pw-label" id="pw-label">—</span></div>' +
      '<span class="hint">Use letters and numbers; a symbol makes it stronger.</span></div>' +
      '<label class="checkbox mb-4"><input type="checkbox" id="rg-terms" required />' +
      "<span>I understand VIGIL AI is a wellness and support tool. It is <strong>not</strong> a medical device and does not provide diagnoses.</span></label>" +
      '<button class="btn primary lg block" type="submit" id="rg-submit">Create account</button>' +
      '<p class="error-text mt-2 hidden" id="rg-error" role="alert"></p></form>' +
      '<div class="alt-auth">Already have an account? <a href="#/login">Sign in</a></div>',
      function (root) {
        const form = root.querySelector("#reg-form");
        const errEl = root.querySelector("#rg-error");
        const passInput = root.querySelector("#rg-pass");
        const bars = root.querySelectorAll(".pw-strength .bar");
        const pwLabel = root.querySelector("#pw-label");
        const labels = ["—", "Weak", "Good", "Strong"];

        passInput.addEventListener("input", function () {
          const score = pwScore(passInput.value);
          bars.forEach(function (b, i) {
            b.className = "bar" + (i < score ? " on-" + score : "");
          });
          pwLabel.textContent = labels[score];
        });

        form.addEventListener("submit", function (e) {
          e.preventDefault();
          errEl.classList.add("hidden");
          const data = {
            full_name: form.full_name.value.trim(),
            email: form.email.value.trim(),
            password: form.password.value,
            role: form.role.value,
          };
          if (!data.full_name || !data.email || !data.password) {
            errEl.textContent = "Please fill in every field.";
            errEl.classList.remove("hidden");
            return;
          }
          if (!root.querySelector("#rg-terms").checked) {
            errEl.textContent = "Please acknowledge the wellness disclaimer to continue.";
            errEl.classList.remove("hidden");
            return;
          }
          const submit = root.querySelector("#rg-submit");
          submit.disabled = true;
          submit.textContent = "Creating account…";
          V.API.auth.register(data).then(function () {
            return V.API.endpoints.me();
          }).then(function (me) {
            V.STORE.setUser(me.user);
            V.STORE.setUnread(me.unread_notifications || 0);
            V.STORE.setMeta(me.mode, me.version);
            toast("Your workspace is ready. Welcome aboard.", "success", "Account created");
            location.hash = "#/dashboard";
          }).catch(function (err) {
            errEl.textContent = err.message || "Could not create the account.";
            errEl.classList.remove("hidden");
            submit.disabled = false;
            submit.textContent = "Create account";
          });
        });
      }
    );
  }

  /* ---------- Forgot password ---------- */

  function renderForgot() {
    setScreen(
      '<div class="head"><h1 class="display">Reset your password</h1><p>Enter your email and we\'ll send a reset link.</p></div>' +
      '<form id="fg-form" novalidate>' +
      '<div class="field"><label for="fg-email">Email</label><input id="fg-email" name="email" type="email" placeholder="you@unit.example" required /></div>' +
      '<button class="btn primary lg block" type="submit">Send reset link</button>' +
      '<p class="error-text mt-2 hidden" id="fg-error" role="alert"></p></form>' +
      '<div id="fg-result"></div>' +
      '<div class="alt-auth"><a href="#/login">← Back to sign in</a></div>',
      function (root) {
        const form = root.querySelector("#fg-form");
        const errEl = root.querySelector("#fg-error");
        form.addEventListener("submit", function (e) {
          e.preventDefault();
          errEl.classList.add("hidden");
          V.API.auth.forgot(form.email.value.trim().toLowerCase()).then(function (res) {
            const resultEl = root.querySelector("#fg-result");
            if (res.demo_reset_token) {
              resultEl.innerHTML =
                '<div class="card mt-4" style="border-left: 4px solid var(--brand)">' +
                '<div class="eyebrow mb-2">Demo mode — no mail server</div>' +
                '<p class="muted" style="font-size:13.5px">In production this link arrives by email. For the demo, continue directly:</p>' +
                '<a class="btn primary mt-4" href="#/reset?token=' + encodeURIComponent(res.demo_reset_token) + '">Set a new password</a></div>';
            } else {
              toast(res.message || "Check your inbox.", "success");
            }
          }).catch(function (err) {
            errEl.textContent = err.message;
            errEl.classList.remove("hidden");
          });
        });
      }
    );
  }

  /* ---------- Reset password ---------- */

  function renderReset(token) {
    const tokenMissing = !token;
    setScreen(
      '<div class="head"><h1 class="display">Set a new password</h1><p>Choose a strong password you haven\'t used before.</p></div>' +
      (tokenMissing
        ? '<div class="card mb-4" style="border-left:4px solid var(--warning)"><p class="muted">This link is missing its reset token. Request a fresh one from the <a href="#/forgot">forgot password</a> page.</p></div>'
        : "") +
      '<form id="rs-form" novalidate>' +
      '<div class="field"><label for="rs-pass">New password</label><input id="rs-pass" name="password" type="password" autocomplete="new-password" placeholder="At least 8 characters" required /></div>' +
      '<div class="field"><label for="rs-pass2">Confirm new password</label><input id="rs-pass2" name="password2" type="password" autocomplete="new-password" required /></div>' +
      '<button class="btn primary lg block" type="submit"' + (tokenMissing ? " disabled" : "") + ">Update password</button>" +
      '<p class="error-text mt-2 hidden" id="rs-error" role="alert"></p></form>' +
      '<div class="alt-auth"><a href="#/login">← Back to sign in</a></div>',
      function (root) {
        if (tokenMissing) return;
        const form = root.querySelector("#rs-form");
        const errEl = root.querySelector("#rs-error");
        form.addEventListener("submit", function (e) {
          e.preventDefault();
          errEl.classList.add("hidden");
          if (form.password.value !== form.password2.value) {
            errEl.textContent = "Passwords don't match.";
            errEl.classList.remove("hidden");
            return;
          }
          V.API.auth.reset(token, form.password.value).then(function (res) {
            toast(res.message || "Password updated.", "success");
            location.hash = "#/login";
          }).catch(function (err) {
            errEl.textContent = err.message;
            errEl.classList.remove("hidden");
          });
        });
      }
    );
  }

  /* ---------- Router glue (pre-app auth screens) ---------- */

  function routeAuthScreen() {
    const hash = location.hash || "#/login";
    const parts = hash.replace(/^#/, "").split("?");
    const params = new URLSearchParams(parts[1] || "");
    if (!document.getElementById("auth-root")) return;
    if (parts[0] === "/register") return renderRegister();
    if (parts[0] === "/forgot") return renderForgot();
    if (parts[0] === "/reset") return renderReset(params.get("token"));
    renderLogin();
  }

  window.addEventListener("vigil:auth-screen", routeAuthScreen);
  window.addEventListener("hashchange", function () {
    if (document.getElementById("auth-root")) routeAuthScreen();
  });

  V.AUTH_PAGES = { routeAuthScreen: routeAuthScreen };
})(window.VIGIL = window.VIGIL || {});
