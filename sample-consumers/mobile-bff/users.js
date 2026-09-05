/**
 * Fake mobile BFF referencing user profile endpoints.
 */

export function profileUrl(id) {
  return `/users/${id}/profile`;
}

export function mapUser(user) {
  // Expects displayName from profile and name from user resource
  return {
    displayName: user.displayName || user.name,
    avatarUrl: user.avatarUrl,
    role: user.role,
  };
}

export async function listUsers(client) {
  const res = await client.get("/users");
  return res.data.map((u) => u.name);
}
