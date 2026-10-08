/* Common escaped labels, panels and dialogs. HTML bodies are composed by trusted templates. */
(function () {
    "use strict";
    const esc = window.PlanmateUtils.escapeHtml;
    const button = (action, label, id = "", extra = "") =>
        `<button type="button" class="button secondary small" data-plan-action="${esc(action)}" data-id="${esc(id)}" ${extra}>${esc(label)}</button>`;
    const field = (label, input, hint = "", variant = "plan") =>
        `<label class="${variant === "form" ? "form-field" : "plan-field"}">${variant === "form" ? "<span>" + label + "</span>" : label}${input}${hint ? "<small>" + hint + "</small>" : ""}</label>`;
    const panel = (title, body) =>
        `<section class="plan-panel"><h2>${esc(title)}</h2>${body}</section>`;
    const notice = (text) => `<p class="plan-notice">${esc(text)}</p>`;
    function openDialog(title, subtitle, content) {
        document.getElementById("dialogContent").innerHTML =
            `<div class="dialog-inner"><div class="dialog-header"><div><h2 id="dialogTitle">${esc(title)}</h2><p>${esc(subtitle)}</p></div><button class="icon-button" data-action="close-dialog" aria-label="Close dialog"><svg aria-hidden="true"><use href="#i-close"/></svg></button></div>${content}</div>`;
        const dialog = document.getElementById("appDialog");
        if (!dialog.open) dialog.showModal();
    }
    window.PlanmateUI = { button, field, panel, notice, openDialog };
})();
