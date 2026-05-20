const EMAIL_KEY = "northstonecrm_email";
const TOKEN_KEY = "northstonecrm_token";
const KNOWN_USER_KEY = "northstonecrm_known_user";
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

export function hasKnownAccount() {
  try {
    return localStorage.getItem(KNOWN_USER_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSession(email: string, token: string) {
  localStorage.setItem(EMAIL_KEY, email);
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(KNOWN_USER_KEY, "1");
  localStorage.removeItem(LEGACY_EMAIL_KEY);
  localStorage.removeItem(LEGACY_TOKEN_KEY);
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(LEGACY_TOKEN_KEY);
}
