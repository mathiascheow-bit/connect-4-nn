const API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api`;

export async function apiCall(endpoint: string, options: RequestInit = {}) {
  const url = `${API_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'API call failed');
  }

  return response.json();
}

export async function updateUserAvatar(userId: string, avatarId: number) {
  return apiCall('/user/update', {
    method: 'POST',
    body: JSON.stringify({ userId, avatarId }),
  });
}

export async function updateUsername(userId: string, newUsername: string) {
  return apiCall('/user/update', {
    method: 'POST',
    body: JSON.stringify({ userId, newUsername }),
  });
}

export async function fetchLeaderboard() {
  return apiCall('/leaderboard');
}

export async function getHealth() {
  return apiCall('/health');
}
