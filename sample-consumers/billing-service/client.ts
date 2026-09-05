/**
 * Fake billing service that calls the Users API.
 */
const API_BASE = process.env.USERS_API || "https://api.acme.internal";

export async function fetchUser(userId: string) {
  const res = await fetch(`${API_BASE}/users/${userId}`);
  const user = await res.json();
  // Depends on `name` and `email` fields from User schema
  return {
    label: `${user.name} <${user.email}>`,
    role: user.role,
    createdAt: user.createdAt,
  };
}

export async function createUser(payload: { email: string; name: string; role?: string }) {
  const res = await fetch(`${API_BASE}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function deleteUser(userId: string) {
  // Calls DELETE /users/{id} which is removed in v2
  return fetch(`${API_BASE}/users/${userId}`, { method: "DELETE" });
}
