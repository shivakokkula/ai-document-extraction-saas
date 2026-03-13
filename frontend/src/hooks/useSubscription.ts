import { useQuery, useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export function useSubscription() {
  return useQuery({
    queryKey: ['subscription'],
    queryFn: () => apiClient.get<any>('/billing/subscription'),
    staleTime: 60_000,
  });
}

export function useUsage() {
  return useQuery({
    queryKey: ['usage'],
    queryFn: () => apiClient.get<any>('/billing/usage'),
    staleTime: 30_000,
  });
}

export function usePlans() {
  return useQuery({
    queryKey: ['plans'],
    queryFn: () => apiClient.get<any>('/billing/plans'),
    staleTime: 300_000,
  });
}

export function useCreateCheckout() {
  return useMutation({
    mutationFn: (plan: 'pro' | 'enterprise') =>
      apiClient.post<{ url: string }>('/billing/checkout', { plan }),
    onSuccess: (data) => {
      window.location.href = data.url;
    },
  });
}

export function useCreatePortal() {
  return useMutation({
    mutationFn: () => apiClient.post<{ url: string }>('/billing/portal'),
    onSuccess: (data) => { window.location.href = data.url; },
  });
}
