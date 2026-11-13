const SIGNIN_ERRORS = {
  access_denied: "Sign-in was cancelled.",
  unavailable: "Sign-in isn't available right now. Try again in a minute.",
  no_flow: "That sign-in took too long. Try again.",
};

function Check() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 8.5 3 3 7-7" /></svg>;
}

/** Shown when nobody is signed in. Forge accounts are Xanom accounts. */
function SignIn() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("signin_error");
  const back = "/hub/index.html" + (window.location.hash || "#applications");
  return (
    <main className="cf-signin">
      <div className="cf-signin__card">
        <a href="/" className="cf-brand"><span aria-hidden="true">✱</span>College Forge</a>
        <h1>Every application, in one place.</h1>
        <p>Track each school’s status and deadlines, let Forge check your portals, and open decisions when you’re ready.</p>
        {code ? <div role="alert" className="cf-notice">{SIGNIN_ERRORS[code] || "Sign-in didn't finish. Try again."}</div> : null}
        <a className="cf-signin__go" href={"/api/xanom/start?return=" + encodeURIComponent(back)}>Continue with Xanom</a>
        <small>Forge uses your Xanom account, the same one as Mullwell, Lodestar and Tare. New here? You can create one on the next screen. Anything you already started in this browser stays with you.</small>
        <ul className="cf-signin__list">
          <li><Check /><span>Portal checks every 12 hours, with logins kept encrypted</span></li>
          <li><Check /><span>Bring your schools over from College Apps in one step</span></li>
          <li><Check /><span>Let Grok, ChatGPT or Claude read and update your list</span></li>
        </ul>
      </div>
    </main>
  );
}

window.SignIn = SignIn;
