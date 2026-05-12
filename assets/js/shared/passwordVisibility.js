const EYE_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M2.1 12s3.6-6.2 9.9-6.2S21.9 12 21.9 12s-3.6 6.2-9.9 6.2S2.1 12 2.1 12Z" />
    <circle cx="12" cy="12" r="2.7" />
  </svg>
`;

const EYE_OFF_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M3.2 4.1 20.8 19.9" />
    <path d="M8.2 6.2A10.7 10.7 0 0 1 12 5.8c6.3 0 9.9 6.2 9.9 6.2a15.2 15.2 0 0 1-3.3 4" />
    <path d="M14.1 14.3A2.7 2.7 0 0 1 9.7 9.9" />
    <path d="M5.8 8.1A15 15 0 0 0 2.1 12s3.6 6.2 9.9 6.2a10.8 10.8 0 0 0 4.2-.8" />
  </svg>
`;

const resolveInput = (button) =>
  button.closest("[data-password-field]")?.querySelector("input[type='password'], input[type='text']");

const setButtonState = (button, visible) => {
  button.setAttribute("aria-pressed", String(visible));
  button.setAttribute("aria-label", visible ? "Ocultar contraseña" : "Mostrar contraseña");
  button.innerHTML = visible ? EYE_OFF_ICON : EYE_ICON;
};

export const bindPasswordVisibility = (root = document) => {
  root.querySelectorAll("[data-password-visibility]").forEach((button) => {
    if (button.dataset.passwordVisibilityBound === "1") return;
    button.dataset.passwordVisibilityBound = "1";
    setButtonState(button, false);
    button.addEventListener("click", () => {
      const input = resolveInput(button);
      if (!input) return;
      const nextVisible = input.type === "password";
      input.type = nextVisible ? "text" : "password";
      setButtonState(button, nextVisible);
      input.focus({ preventScroll: true });
    });
  });
};
