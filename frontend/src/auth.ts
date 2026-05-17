const EMAIL_KEY = "northstonecrm_email";
const TOKEN_KEY = "northstonecrm_token";
const LEGACY_EMAIL_KEY = "dealios_email";
const LEGACY_TOKEN_KEY = "dealios_token";

export function getEmail() {
  try {
    return localStorage.getItem(EMAIL_KEY) ?? localStorage.getItem(LEGACY_EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(LEGACY_TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setSession(email: string, token: string) {
  localStorage.setItem(EMAIL_KEY, email);
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.removeItem(LEGACY_EMAIL_KEY);
  localStorage.removeItem(LEGACY_TOKEN_KEY);
}

export function clearSession() {
  localStorage.removeItem(EMAIL_KEY);
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(LEGACY_EMAIL_KEY);
  localStorage.removeItem(LEGACY_TOKEN_KEY);
}
