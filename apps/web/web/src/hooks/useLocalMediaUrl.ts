import { useEffect, useState } from 'react';
import { api } from '../api';
import { FolderReconnectError } from '../local-library';

export function useLocalMediaUrl(mediaId: number) {
  const [resolvedMediaId, setResolvedMediaId] = useState(mediaId);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<Error|null>(null);
  const [loading, setLoading] = useState(true);
  const [revision,setRevision] = useState(0);

  useEffect(() => {
    let current = true;
    setResolvedMediaId(mediaId);
    setUrl('');
    setError(null);
    setLoading(true);
    api.mediaSource(mediaId)
      .then((source) => { if (current) setUrl(source); })
      .catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason : new Error('The local video could not be opened.')); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [mediaId,revision]);

  const resolved=resolvedMediaId===mediaId;
  return {url:resolved?url:'',error:resolved?error?.message??'':'',loading:!resolved||loading,
    canReconnect:resolved&&error instanceof FolderReconnectError,revision,retry:()=>setRevision(value=>value+1)};
}
