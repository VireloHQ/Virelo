import { useEffect, useState } from 'react';
import { api } from '../api';

export function useLocalMediaUrl(mediaId: number) {
  const [resolvedMediaId, setResolvedMediaId] = useState(mediaId);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let current = true;
    setResolvedMediaId(mediaId);
    setUrl('');
    setError('');
    setLoading(true);
    api.mediaSource(mediaId)
      .then((source) => { if (current) setUrl(source); })
      .catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : 'The local video could not be opened.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [mediaId]);

  return resolvedMediaId === mediaId ? { url, error, loading } : { url:'', error:'', loading:true };
}
