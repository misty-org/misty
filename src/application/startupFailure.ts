export function showStartupFailure(reload = () => window.location.reload()) {
  const root = document.getElementById("root");
  if (!root) return;
  const panel = document.createElement("main");
  panel.setAttribute("role", "alert");
  panel.style.cssText =
    "min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:32px;box-sizing:border-box;background:#131313;color:#eee;font:14px/1.5 system-ui;text-align:center";
  const title = document.createElement("h1");
  title.textContent = "Misty couldn’t finish loading";
  title.style.cssText = "font-size:22px;margin:0;font-weight:600";
  const message = document.createElement("p");
  message.textContent = "Reload to try again.";
  message.style.cssText = "margin:0;max-width:38ch;color:#aaa";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Reload Misty";
  button.style.cssText =
    "margin-top:6px;padding:9px 16px;border:1px solid #666;border-radius:6px;background:#eee;color:#161616;font:inherit;cursor:pointer";
  button.addEventListener("click", reload);
  panel.append(title, message, button);
  root.replaceChildren(panel);
  button.focus();
}
