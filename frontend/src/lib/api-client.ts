import axios, { AxiosInstance, AxiosError } from 'axios';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: `${BASE_URL}/api/v1`,
      headers: { 'Content-Type': 'application/json' },
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
        const original = error.config as any;
        if (error.response?.status === 401 && !original._retry) {
          original._retry = true;
          try {
            const refreshToken = localStorage.getItem('refresh_token');
            if (!refreshToken) throw new Error('No refresh token');
            const { data } = await axios.post(`${BASE_URL}/api/v1/auth/refresh`, { refreshToken });
            localStorage.setItem('access_token', data.accessToken);
            localStorage.setItem('refresh_token', data.refreshToken);
            original.headers.Authorization = `Bearer ${data.accessToken}`;
            return this.client(original);
          } catch {
            localStorage.clear();
            window.location.href = '/auth/login';
          }
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
