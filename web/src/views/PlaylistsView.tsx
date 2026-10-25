import { useState } from 'react';
import { Button, Input } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Play, Queue, Shuffle } from '@phosphor-icons/react';
import { api } from '../api';
import { PageSkeleton } from '../components/PageSkeleton';
import { PlaybackQueue } from '../components/PlaybackQueue';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { usePlaybackQueue } from '../hooks/usePlaybackQueue';
import { playlistName } from '../utils/playlist-values';
import type { PlaylistDetail } from '../types';
import '../components/Playlists.css';

export function PlaylistsView() {
  const navigate = useNavigate(), client = useQueryClient();
  const [name, setName] = useState('');
  const query = useQuery({ queryKey: ['playlists'], queryFn: api.playlists });
  const create = useMutation({
    mutationFn: () => api.createPlaylist({ name: playlistName(name), mediaIds: [] }),
    onSuccess: async playlist => { await client.invalidateQueries({ queryKey: ['playlists'] }); void navigate({ to: '/playlists/$playlistId', params: { playlistId: String(playlist.id) } }); }
  });
  return <div className="content-view playlists-view">
    <header className="content-heading"><div><h1>Playlists</h1><p>Your videos, in your own order.</p></div><Link to="/library">Browse library</Link></header>
    <form className="playlist-create" onSubmit={event => { event.preventDefault(); if (!create.isPending) create.mutate(); }}>
      <label className="playlist-field"><span>New playlist</span><Input aria-label="New playlist name" maxLength={100} placeholder="Playlist name" value={name} onChange={event => setName(event.target.value)}/></label>
      <Button type="submit" isPending={create.isPending} isDisabled={create.isPending || !name.trim()}>Create playlist</Button>
    </form>
    {create.error && <p className="error-copy" role="alert">{create.error.message}</p>}
    {query.isPending ? <p role="status">Loading playlists…</p> : query.isError ? <div className="playlist-feedback" role="alert"><p>{query.error.message}</p><Button variant="secondary" onPress={() => void query.refetch()}>Try again</Button></div>
      : query.data.length ? <ul className="playlist-collection" aria-label="Saved playlists">{query.data.map(playlist => <li key={playlist.id}>
        <Link to="/playlists/$playlistId" params={{ playlistId: String(playlist.id) }}>
          <Queue aria-hidden="true"/><div><h2>{playlist.name}</h2><p>{playlist.itemCount} video{playlist.itemCount === 1 ? '' : 's'}{playlist.unavailableCount ? ' · ' + playlist.unavailableCount + ' unavailable' : ''}</p></div><span>Open</span>
        </Link>
      </li>)}</ul> : <div className="playlist-empty"><Queue/><h2>No playlists yet</h2><p>Create one above, add a video from its details, or save a playback queue.</p></div>}
  </div>;
}

export function PlaylistView() {
  const { playlistId } = useParams({ from: '/playlists/$playlistId' });
  const id = Number(playlistId);
  const query = useQuery({ queryKey: ['playlist', id], queryFn: () => api.playlist(id), refetchOnWindowFocus: false });
  if (query.isPending) return <PageSkeleton kind="library"/>;
  if (query.isError) return <div className="content-view playlist-feedback" role="alert"><h1>Playlist unavailable</h1><p>{query.error.message}</p><Button variant="secondary" onPress={() => void query.refetch()}>Try again</Button><Link to="/playlists">All playlists</Link></div>;
  return <PlaylistEditor key={query.data.id + ':' + query.data.revision} playlist={query.data} reload={() => query.refetch().then(result => { if (result.error) throw result.error; })}/>;
}

function PlaylistEditor({ playlist, reload }: { playlist: PlaylistDetail; reload: () => Promise<unknown> }) {
  const navigate = useNavigate(), client = useQueryClient();
  const [name, setName] = useState(playlist.name), [notice, setNotice] = useState('');
  const { queue, items, update } = usePlaybackQueue(playlist.items, playlist.items[0]?.id ?? 0);
  const dirty = name.trim() !== playlist.name || items.length !== playlist.items.length || items.some((item, index) => item.id !== playlist.items[index]?.id);
  const save = useMutation({
    mutationFn: () => api.updatePlaylist(playlist.id, { revision: playlist.revision, name: playlistName(name), mediaIds: items.map(item => item.id) }),
    onSuccess: saved => { client.setQueryData(['playlist', playlist.id], saved); void client.invalidateQueries({ queryKey: ['playlists'] }); }
  });
  const play = (index = 0, shuffle = false) => {
    if (dirty) { setNotice('Save your changes before starting playback.'); return; }
    const selected = items[shuffle ? Math.floor(Math.random() * items.length) : index];
    if (selected) void navigate({ to: '/watch/$mediaId', params: { mediaId: String(selected.id) }, search: { queue: true, playlistId: playlist.id, sort: shuffle ? 'random' : undefined } });
  };
  return <div className="content-view playlist-editor">
    <Link className="playlist-back" to="/playlists">All playlists</Link>
    <header className="content-heading"><div><h1>{playlist.name}</h1><p>{playlist.itemCount} videos. Save changes to keep the new order.</p></div>
      <div className="heading-controls"><Button isDisabled={!items.length || dirty} onPress={() => play()}><Play weight="fill"/> Play all</Button><Button variant="secondary" isDisabled={items.length < 2 || dirty} onPress={() => play(0, true)}><Shuffle/> Shuffle</Button></div>
    </header>
    <form className="playlist-create" onSubmit={event => { event.preventDefault(); if (dirty && !save.isPending) save.mutate(); }}>
      <label className="playlist-field"><span>Playlist name</span><Input aria-label="Playlist name" maxLength={100} value={name} onChange={event => setName(event.target.value)}/></label>
      <Button type="submit" isPending={save.isPending} isDisabled={!dirty || save.isPending}>Save changes</Button>
    </form>
    {save.error && <div className="playlist-feedback" role="alert"><p>{save.error.message}</p><p>Your unsaved changes are still shown below.</p></div>}
    {notice && <p className="playlist-notice" role="status">{notice}</p>}
    {playlist.unavailableCount > 0 && <p className="playlist-notice">{playlist.unavailableCount} unavailable video{playlist.unavailableCount === 1 ? '' : 's'} skipped. References are kept; restore library access to see them again.</p>}
    <div className="playlist-section-heading"><h2>Videos</h2><Link to="/library">Add videos from library</Link></div>
    {!items.length && <p className="playlist-empty-copy">No available videos. Add a video from its details or save a queue to this playlist.</p>}
    <PlaybackQueue editing items={items} activeIndex={-1} repeatMode="off" onRepeatChange={() => {}} onSelect={index => play(index)} state={queue} onEdit={update}/>
    <footer className="playlist-management">
      <span role="status">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
      <div><ConfirmationDialog triggerLabel="Reload playlist" title="Reload playlist?" confirmLabel="Reload" onConfirm={reload}><p>Discard unsaved edits and load the latest saved playlist. Original files stay unchanged.</p></ConfirmationDialog>
      <ConfirmationDialog triggerLabel="Delete playlist" title="Delete playlist?" confirmLabel="Delete playlist" onConfirm={async () => {
        await api.deletePlaylist(playlist.id, playlist.revision); await client.invalidateQueries({ queryKey: ['playlists'] });
        client.removeQueries({ queryKey: ['playlist', playlist.id] }); void navigate({ to: '/playlists' });
      }}><p>Delete <strong>{playlist.name}</strong> from your saved playlists? Videos, favorites and watch history stay unchanged.</p></ConfirmationDialog></div>
    </footer>
  </div>;
}
