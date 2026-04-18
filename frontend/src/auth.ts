export function getEmail() {
  try {
    return localStorage.getItem("dealios_email") ?? "";
  } catch {
    return "";
  }
}

export function getToken() {
  try {
    return localStorage.getItem("dealios_token") ?? "";
  } catch {
    return "";
  }
}

export function setSession(email: string, token: string) {
  localStorage.setItem("dealios_email", email);
  localStorage.setItem("dealios_token", token);
}

export function clearSession() {
  localStorage.removeItem("dealios_email");
  localStorage.removeItem("dealios_token");
}

