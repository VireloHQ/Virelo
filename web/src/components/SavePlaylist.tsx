import { useState } from 'react';
import { Input } from '@heroui/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { ConfirmationDialog } from './ConfirmationDialog';
import { Select } from './Select';
import { playlistName } from '../utils/playlist-values';
import './Playlists.css';

export function SavePlaylist({ mediaIds, label = 'Add to playlist' }: { mediaIds: number[]; label?: string }) {
  const client = useQueryClient();
  const [enabled, setEnabled] = useState(false), [name, setName] = useState(''), [target, setTarget] = useState('new');
  const [notice, setNotice] = useState('');
  const playlists = useQuery({ queryKey: ['playlists'], queryFn: api.playlists, enabled });
  return <div className="save-playlist">
    <ConfirmationDialog triggerLabel={label} title="Save to playlist" confirmLabel="Save" confirmVariant="primary"
      onOpen={() => { setEnabled(true); void playlists.refetch({ cancelRefetch: false }); setName(''); setTarget('new'); setNotice(''); }}
      onConfirm={async () => {
        if (!mediaIds.length) throw new Error('Choose at least one video.');
        const current = playlists.data?.find(item => item.id === Number(target));
        const saved = target === 'new' ? await api.createPlaylist({ name: playlistName(name), mediaIds })
          : current ? await api.updatePlaylist(current.id, { revision: current.revision, mediaIds, append: true })
          : (() => { throw new Error('Reload the playlist list and try again.'); })();
        await client.invalidateQueries({ queryKey: ['playlists'] });
        await client.invalidateQueries({ queryKey: ['playlist', saved.id] });
        setNotice('Saved to ' + saved.name + '.');
      }}>
      <div className="playlist-form">
        <Select label="Playlist" value={target} options={[{ value: 'new', label: 'New playlist' },
          ...(playlists.data ?? []).map(item => ({ value: String(item.id), label: item.name }))]} onChange={setTarget}/>
        {target === 'new' && <label className="playlist-field"><span>Playlist name</span><Input autoFocus aria-label="Playlist name" maxLength={100} value={name} onChange={event => setName(event.target.value)}/></label>}
        <p>{mediaIds.length} video{mediaIds.length === 1 ? '' : 's'}.{target !== 'new' ? ' Added after existing videos; duplicates are skipped.' : ''} Original files stay unchanged.</p>
        {target !== 'new' && <button type="button" onClick={() => void playlists.refetch()}>Refresh playlists</button>}
        {playlists.isError && <p className="error-copy" role="alert">Could not load existing playlists. <button type="button" onClick={() => void playlists.refetch()}>Try again</button></p>}
      </div>
    </ConfirmationDialog>
    {notice && <span className="playlist-notice" role="status">{notice}</span>}
  </div>;
}
