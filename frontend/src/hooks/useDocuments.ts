import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import toast from 'react-hot-toast';

export function useDocuments(page = 1, limit = 20, status?: string) {
  return useQuery({
    queryKey: ['documents', page, limit, status],
    queryFn: () => apiClient.get<any>('/documents', { page, limit, status }),
    staleTime: 30_000,
  });
}

export function useDocument(id: string) {
  return useQuery({
    queryKey: ['document', id],
    queryFn: () => apiClient.get<any>(`/documents/${id}`),
    enabled: !!id,
  });
}

export function useDocumentStatus(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ['document-status', id],
    queryFn: () => apiClient.get<any>(`/documents/${id}/status`),
    enabled: enabled && !!id,
    refetchInterval: (data: any) =>
      data?.status === 'completed' || data?.status === 'failed' ? false : 3000,
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/documents/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      toast.success('Document deleted');
    },
    onError: () => toast.error('Failed to delete document'),
  });
}

export function useUpload() {
  const qc = useQueryClient();
  const [progress, setProgress] = useState(0);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      // Step 1: Get presigned URL
      const { uploadUrl, documentId } = await apiClient.post<any>('/documents/upload-url', {
        filename: file.name,
        fileSize: file.size,
        mimeType: file.type,
      });

      // Step 2: Upload directly to S3
      await uploadToS3(uploadUrl, file, setProgress);

      // Step 3: Trigger processing
      return apiClient.post<any>('/documents', { documentId });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      toast.success('Document uploaded and queued for processing');
      setProgress(0);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Upload failed');
      setProgress(0);
    },
  });

  return { ...uploadMutation, progress };
}

async function uploadToS3(url: string, file: File, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => xhr.status === 200 ? resolve() : reject(new Error('S3 upload failed'));
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.send(file);
  });
}

// Needed for useUpload hook
import { useState } from 'react';
