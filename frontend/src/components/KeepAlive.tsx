'use client';

import { useEffect } from 'react';
import axios from 'axios';

export default function KeepAlive() {
  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
    const aiBase = process.env.NEXT_PUBLIC_AI_SERVICE_URL || 'https://ai-document-extraction-saas-khz5.onrender.com';
    const intervalMs = 60 * 1000;

    const ping = async () => {
      try {
        await axios.get(`${apiBase}/health`);
      } catch {}
      try {
        await axios.get(`${aiBase}/health`);
      } catch {}
    };

    ping();
    const id = setInterval(ping, intervalMs);
    return () => clearInterval(id);
  }, []);

  return null;
}
