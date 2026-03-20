import axios, { AxiosInstance, AxiosError } from 'axios';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const DEFAULT_TIMEOUT_MS = 90000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 800;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: `${BASE_URL}/api/v1`,
      headers: { 'Content-Type': 'application/json' },
      timeout: DEFAULT_TIMEOUT_MS,
    });

    // Attach JWT on every request
    this.client.interceptors.request.use((config) => {
      if (typeof window !== 'undefined') {
        const token = localStorage.getItem('access_token');
        if (token) config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    // Auto-refresh on 401
    this.client.interceptors.response.use(
      (res) => res,
      async (error: AxiosError) => {
        if (typeof window !== 'undefined') {
          console.error('[API] request failed', {
            method: error.config?.method,
            url: error.config?.url,
            status: error.response?.status,
            data: error.response?.data,
            message: error.message,
          });
        }
        const original = error.config as any;
        const url = original?.url || '';
        const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/register') || url.includes('/auth/refresh');

        if (error.response?.status === 401) {
          if (typeof window !== 'undefined') {
            localStorage.clear();
            if (!isAuthEndpoint) {
              window.location.href = '/auth/login';
            }
          }
        }

        // Retry on timeouts / network errors / 502-504
        const status = error.response?.status;
        const isTimeout = error.code === 'ECONNABORTED' || /timeout/i.test(error.message || '');
        const isNetwork = !error.response;
        const isRetryableStatus = status === 502 || status === 503 || status === 504;
        const shouldRetry = (isTimeout || isNetwork || isRetryableStatus) && (original._retryCount || 0) < MAX_RETRIES;

        if (shouldRetry) {
          original._retryCount = (original._retryCount || 0) + 1;
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, original._retryCount - 1);
          await sleep(delay);
          return this.client(original);
        }

        return Promise.reject(error);
      },
    );
  }

  async get<T>(url: string, params?: object): Promise<T> {
    const { data } = await this.client.get<T>(url, { params });
    return data;
  }

  async post<T>(url: string, body?: object): Promise<T> {
    const { data } = await this.client.post<T>(url, body);
    return data;
  }

  async patch<T>(url: string, body?: object): Promise<T> {
    const { data } = await this.client.patch<T>(url, body);
    return data;
  }

  async delete<T>(url: string): Promise<T> {
    const { data } = await this.client.delete<T>(url);
    return data;
  }
}

export const apiClient = new ApiClient();
