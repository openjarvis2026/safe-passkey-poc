// Simple hash-based router

export type Route =
  | { page: 'home' }
  | { page: 'join'; safeAddress: `0x${string}` }
  | { page: 'sign'; data: string };

export function parseRoute(): Route {
  const hash = window.location.hash;

  if (hash.startsWith('#/join')) {
    const params = new URLSearchParams(hash.split('?')[1] || '');
    const safe = params.get('safe');
    if (safe && safe.startsWith('0x')) {
      return { page: 'join', safeAddress: safe as `0x${string}` };
    }
  }

  if (hash.startsWith('#/sign')) {
    const params = new URLSearchParams(hash.split('?')[1] || '');
    const data = params.get('data');
    if (data) {
      return { page: 'sign', data };
    }
  }

  return { page: 'home' };
}

export function navigateTo(hash: string): void {
  window.location.hash = hash;
}
